import { Point, Position } from 'unist';
import read, { SourcePoint, SourcePosition, TextKit } from '../read';

const point = ((line: number, column: number, offset?: number) => ({ line, column, ...(offset !== undefined ? { offset } : {}) })) as {
  (line: number, column: number, offset: number): SourcePoint;
  (line: number, column: number): Point;
};

const pos = (([startLine, startColumn, offset1]: [number, number] | [number, number, number], [endLine, endColumn, offset2]: [number, number] | [number, number, number]): Position => ({
  start: point(startLine, startColumn, offset1),
  end: point(endLine, endColumn, offset2),
})) as {
  ([startLine, startColumn, offset1]: [number, number, number], [endLine, endColumn, offset2]: [number, number, number]): SourcePosition;
  ([startLine, startColumn]: [number, number], [endLine, endColumn]: [number, number]): Position;
};

const testReader = (testName: string, text: string, op: (r: TextKit) => void) => {
  return it(testName, () => {
    op(read(text));
  });
};

type Params = { [K in keyof Omit<TextKit, 'numberOfLines'>]: Parameters<TextKit[K]> };
type Return = { [K in keyof Omit<TextKit, 'numberOfLines'>]: ReturnType<TextKit[K]> };
type SingleOrListParam<K extends keyof Omit<TextKit, 'numberOfLines'>> =
  Params[K] extends [any] ? Exclude<Params[K][0], Function | Array<any>> : Params[K];

const testReaderFn = <K extends keyof Omit<TextKit, 'numberOfLines'>>(pty: K) =>
  (testName: string, text: string,
    ...rest: Params[K] extends [] ? [expected: Return[K] | ((r: TextKit) => Return[K])]
      : [testArgs: SingleOrListParam<K> | ((r: TextKit) => SingleOrListParam<K>),
        expected: Return[K] | ((r: TextKit) => Return[K])]) => {
    const [testArgs, expected] = rest.length === 2 ? rest : [[] as SingleOrListParam<K>, rest[0]];
    return testReader(testName, text, r => {
      const calcArgs: SingleOrListParam<K> = typeof testArgs === 'function' ? testArgs(r) : testArgs;
      const args: Params[K] = calcArgs instanceof Array ? calcArgs : [calcArgs] as any;
      const exp = typeof expected === 'function' ? expected(r) : expected;
      expect((r[pty] as any)(...args)).toEqual(exp);
    });
  };

describe("numberOfLines", () => {
  const testNumberOfLines = (testName: string, text: string, expected: number) => {
    return testReader(testName, text, r => expect(r.numberOfLines).toEqual(expected));
  };

  testNumberOfLines("with empty string", "", 0);
  testNumberOfLines("just a newline", "\n", 1);
  testNumberOfLines("with one newline", "test\n", 1);
  testNumberOfLines("with some newlines", "test1\ntest2\n", 2);
  testNumberOfLines("starts with newline", "\ntest", 2);
  testNumberOfLines("ends with newline", "test\n", 1);
  testNumberOfLines("ends with carriage return", "test\r", 1);
  testNumberOfLines("split with carriage return", "test\rtest", 2);
});

describe("substring", () => {
  const testSubstring = testReaderFn('substring');

  describe("out-of-bounds", () => {
    testSubstring("start line before beginning of document, end after", "test", pos([-1, 1], [2, 1]), "test");
    testSubstring("start line in document, end after", "test", pos([1, 1], [2, 1]), "test");
    testSubstring("start line before beginning of document, end within", "test", pos([-1, 1], [1, 2]), "t");
    testSubstring("end is before start", "test", pos([1, 4], [1, 1]), "");
    testSubstring("end is equal to start", "test", pos([1, 3], [1, 3]), "");
  });

  testSubstring("within line", "tests", pos([1, 2], [1, 5]), "est");
  testSubstring("over multiple lines", "tests\ntests\ntests", pos([1, 3], [3, 4]), "sts\ntests\ntes");
  testSubstring("end is equal to start, inclusive end", "test", pos([1, 3], [1, 4]), "s");

  describe("end is EOL", () => {
    testSubstring("with one line, no newline", "test", { start: point(1, 1), end: 'EOL' }, "test");
    testSubstring("with one line, newline, doesn't include newline", "test\n", { start: point(1, 1), end: 'EOL' }, "test");
    testSubstring("with one line, newline, inclusive end, includes newline", "test\n", { start: point(1, 1), end: 'EOL' }, "test");
    testSubstring("with multiple lines", "test1\ntest2\ntest3", { start: point(2, 1), end: 'EOL' }, "test2");
  });

  describe("end is EOF", () => {
    testSubstring("with one line", "test", { start: point(1, 1), end: 'EOF' }, "test");
    testSubstring("with multiple lines", "test1\ntest2\ntest3", { start: point(2, 1), end: 'EOF' }, "test2\ntest3");
    testSubstring("with multiple lines and ending newline", "test1\ntest2\ntest3\n", { start: point(2, 1), end: 'EOF' }, "test2\ntest3\n");
  });

  describe("with only start specified (default is EOL)", () => {
    testSubstring("single line", "test", { start: point(1, 1) }, "test");
    testSubstring("multiple lines", "test1\ntest2\ntest3", { start: point(2, 1) }, "test2");
  });

  describe("substring from bof to eof is full text", () => {
    for (const text of ["", "test", "test\n", "test1\ntest2", "test1\ntest2\n"]) {
      testSubstring(`with text "${text}"`, text, r => ({ start: r.bof(), end: r.eof() }), text);
    }
  });
});

describe("charAt", () => {
  const testCharAt = testReaderFn("charAt");

  testCharAt("empty text", "", r => r.bof(), undefined);
  testCharAt("newline", "test\ntest", r => r.eol(1), "\n");
  testCharAt("middle of line", "test", point(1, 2), "e");
  testCharAt("eof", "test", r => r.eof(), undefined);
});

describe("linePosition", () => {
  const testLinePosition = testReaderFn('linePosition');

  describe("out-of-bounds lines", () => {
    testLinePosition("line < 1", "test", 0, undefined);
    testLinePosition("line > number of lines", "test", 2, undefined);
  });

  testLinePosition("only line", "test", 1, pos([1, 1, 0], [1, 5, 4]));
  testLinePosition("line with newline", "test\n", 1, pos([1, 1, 0], [1, 6, 5]));
  testLinePosition("middle line", "test\ntest\ntest", 2, pos([2, 1, 5], [3, 1, 10]));
});

describe("location", () => {
  const testLocation = testReaderFn('location');

  describe("location out of range", () => {
    testLocation("empty document", "", 0, point(1, 1, 0));
    testLocation("index at EOF", "test", 4, point(1, 5, 4));
    testLocation("index higher than EOF", "test", 5, point(1, 5, 4));
    testLocation("index higher than EOF, multiline", "test1\ntest2", 12, point(2, 6, 11));
    testLocation("negative index", "test", -1, point(1, 1, 0));
  });

  describe("location in bounds", () => {
    testLocation("beginning of line", "test", 0, point(1, 1, 0));
    testLocation("end of line", "test", 3, point(1, 4, 3));
    testLocation("beginning of document", "test\ntest", 0, point(1, 1, 0));
    testLocation("end of document", "test\ntest", 8, point(2, 4, 8));
    testLocation("next line", "test\ntest", 5, point(2, 1, 5));
    testLocation("middle of text", "tests\ntests\ntests", 8, point(2, 3, 8));
  });

  describe("location inverse of index", () => {
    for (let i = 0; i <= 11; i++) {
      testReader(`with i=${i}`, "test1\ntest2", r => expect(r.location(i).offset).toEqual(i));
    }
  });
});

describe("match", () => {
  const testMatch = (testName: string, text: string,
    testArgs: Params['match'] | ((r: TextKit) => Params['match']),
    expected: ([SourcePosition, string[]] | undefined) | ((r: TextKit) => [SourcePosition, string[]] | undefined)) => {
    return testReaderFn('match')(testName, text, testArgs, r => {
      const exp = typeof expected === 'function' ? expected(r) : expected;
      return exp && { position: exp[0], captures: exp[1] };
    });
  };

  describe("multiline", () => {
    testMatch("star", "_Test\nTest_", [/[\s\S]*/m, pos([1, 1], [2, 5])], [pos([1, 1, 0], [2, 5, 10]), ["_Test\nTest"]]);
    testMatch("star without multiline flag", "_Test\nTest_", [/[\s\S]*/, pos([1, 1], [2, 6])], [pos([1, 1, 0], [2, 6, 11]), ["_Test\nTest_"]]);
    testMatch("explicit", "_Test\nTest_", [/_Test\nTest_/m, pos([1, 1], [2, 6])], [pos([1, 1, 0], [2, 6, 11]), ["_Test\nTest_"]]);
    testMatch("explicit without multiline flag", "_Test\nTest_", [/_Test\nTest_/, pos([1, 1], [2, 6])], [pos([1, 1, 0], [2, 6, 11]), ["_Test\nTest_"]]);
  });

  testMatch("with capture groups", "Test", [/T(es(t))/, pos([1, 1], [1, 5])], [pos([1, 1, 0], [1, 5, 4]), ["Test", "est", "t"]]);
  testMatch("with non-match", "Test", [/nope/, pos([1, 1], [1, 4])], undefined);

  testMatch("un-anchored match in part of text", "Test", [/es/, pos([1, 1], [1, 4])], [pos([1, 2, 1], [1, 4, 3]), ["es"]]);

  describe("with position restriction", () => {
    testMatch("part of document, match anchored", "Test\nTest", [/^st\nTe$/, pos([1, 3], [2, 3])], [pos([1, 3, 2], [2, 3, 7]), ["st\nTe"]]);
    testMatch("part of document, match un-anchored", "Test\nTest", [/st\nTe/, pos([1, 3], [2, 3])], [pos([1, 3, 2], [2, 3, 7]), ["st\nTe"]]);
    testMatch("restriction prevents match", "Test\nTest", [/Test/, pos([1, 3], [2, 3])], undefined);
  });

  testMatch("match to end of file includes end of file", "test", r => [/test/, { start: point(1, 1), end: r.eof() }], r => [{ start: point(1, 1, 0), end: r.eof() }, ["test"]]);

  testMatch("match against empty string", "", [new RegExp(""), pos([1, 1], [1, 1])], undefined);
  testMatch("empty match", "Test", [new RegExp(""), pos([1, 1], [1, 4])], [pos([1, 1, 0], [1, 1, 0]), [""]]);
  testMatch("empty match with empty position restriction", "Test", [new RegExp(""), pos([1, 1, 0], [1, 1, 0])], undefined);
  testMatch("empty match with position restriction", "Test", [new RegExp(""), pos([1, 1], [1, 2])], [pos([1, 1, 0], [1, 1, 0]), [""]]);
  testMatch("if end is before start this is undefined", "Test\nTest", [/Test/, pos([2, 1], [1, 1])], undefined);
  testMatch("if end is before start this is undefined (even with empty RegExp)", "Test\nTest", [new RegExp(""), pos([2, 1], [1, 1])], undefined);
  testMatch("a newline", "\n", [/^\n/, pos([1, 1], [1, 1])], undefined);
});

describe("shift", () => {
  const testShift = testReaderFn('shift');

  describe("out-of-bounds shifts", () => {
    testShift("shifting beyond end of document", "test", [point(1, 1), 6], r => r.eof());
    testShift("shifting beyond end of document with newline", "test\n", [point(1, 1), 6], r => r.eof());
    testShift("shifting before start of document", "test", [point(1, 1), -1], point(1, 1, 0));
  });

  describe("in-bounds shifts", () => {
    testShift("shift to start of next line", "test\ntest", [point(1, 4), 2], point(2, 1, 5));
    testShift("shift to start of next line (on newline)", "test\ntest", [point(1, 5), 1], point(2, 1, 5));
    testShift("shift to end of previous newline", "test\ntest", [point(2, 1), -1], point(1, 5, 4));
    testShift("shift to end of previous line", "test\ntest", [point(2, 1), -2], point(1, 4, 3));
  });
});

describe("lastNonEOL", () => {
  const testLastNonEOL = testReaderFn("lastNonEOL");

  describe("out-of-bounds", () => {
    testLastNonEOL("line before start of document", "test", -1, undefined);
    testLastNonEOL("line after end of document", "test", 2, undefined);
  });

  describe("single line", () => {
    testLastNonEOL("no newline", "test", 1, point(1, 4, 3));
    testLastNonEOL("newline", "test\n", 1, point(1, 4, 3));
    testLastNonEOL("newline (carriage return)", "test\r", 1, point(1, 4, 3));
    testLastNonEOL("newline (carriage return, newline)", "test\r\n", 1, point(1, 4, 3));
  });

  describe("multiple lines", () => {
    testLastNonEOL("no newline", "test1\ntest2\ntest3", 3, point(3, 5, 16));
    testLastNonEOL("newline", "test1\ntest2\ntest3", 2, point(2, 5, 10));
  });

  describe("empty line", () => {
    testLastNonEOL("empty document", "", 1, undefined);
    testLastNonEOL("single line", "\n", 1, undefined);
    testLastNonEOL("multiple lines", "foo\n\nbar", 2, undefined);
    testLastNonEOL("picking non-empty line", "foo\n\nbar", 3, point(3, 3, 7));
  });
});

describe("bol", () => {
  const testBol = testReaderFn("bol");

  describe("out-of-bounds", () => {
    testBol("empty document", "", 1, undefined);
    testBol("line before start of document", "test", -1, undefined);
    testBol("line after end of document", "test", 2, undefined);
  });

  describe("single line", () => {
    testBol("some text, no newline", "test", 1, point(1, 1, 0));
    testBol("some text, newline", "test\n", 1, point(1, 1, 0));
    testBol("just a newline", "\n", 1, point(1, 1, 0));
  });

  describe("multiple lines", () => {
    testBol("some text, no newline", "test1\ntest2", 2, point(2, 1, 6));
    testBol("some text, newline", "test1\ntest2", 2, point(2, 1, 6));
    testBol("just a newline", "test1\n\n", 2, point(2, 1, 6));
  });
});

describe("eol", () => {
  const testEol = testReaderFn("eol");

  describe("out-of-bounds", () => {
    testEol("empty document", "", 1, undefined);
    testEol("line before start of document", "test", -1, undefined);
    testEol("line after end of document", "test", 2, undefined);
  });

  describe("single line", () => {
    testEol("no newline", "test", 1, r => r.eof());
    testEol("newline", "test\n", 1, point(1, 5, 4));
    testEol("newline (carriage return)", "test\r", 1, point(1, 5, 4));
    testEol("newline (carriage return, newline)", "test\r\n", 1, point(1, 5, 4));
  });

  describe("multiple lines", () => {
    testEol("no newline", "test1\ntest2\ntest3", 3, r => r.eof());
    testEol("newline", "test1\ntest2\ntest3", 2, point(2, 6, 11));
  });
});

describe("eof", () => {
  const testEof = testReaderFn("eof");

  testEof("empty document", "", point(1, 1, 0));

  describe("single line", () => {
    testEof("no newline", "test", point(1, 5, 4));
    testEof("newline", "test\n", point(1, 6, 5));
    testEof("newline (carriage return)", "test\r", point(1, 6, 5));
  });

  describe("multiple lines", () => {
    testEof("no newline", "test1\ntest2\ntest3", point(3, 6, 17));
    testEof("newline", "test1\ntest2\ntest3\n", point(3, 7, 18));
  });
});

describe("bof", () => {
  const testBof = testReaderFn("bof");

  testBof("empty document", "", point(1, 1, 0));

  describe("single line", () => {
    testBof("no newline", "test", point(1, 1, 0));
    testBof("newline", "test\n", point(1, 1, 0));
  });

  describe("multiple lines", () => {
    testBof("no newline", "test1\ntest2\ntest3", point(1, 1, 0));
    testBof("newline", "test1\ntest2\ntest3\n", point(1, 1, 0));
  });
});

describe("distance", () => {
  const testDistance = testReaderFn("distance");

  describe("distance from a point to itself", () => {
    testDistance("empty document, EOF", "", r => ({ start: r.eof(), end: r.eof() }), 0);
    testDistance("non-empty document, EOF", "", r => ({ start: r.eof(), end: r.eof() }), 0);
    testDistance("non-empty document, non-EOF", "test", pos([1, 2], [1, 2]), 0);
  });

  describe("distance from start to end is length", () => {
    for (const text of ["", "test", "test\n", "test1\ntest2", "test1\ntest2\n"]) {
      testDistance(`with text "${text}"`, text, r => ({ start: point(1, 1), end: r.eof() }), text.length);
    }
  });

  testDistance("subset of document", "test1\ntest2", pos([1, 3], [2, 2]), 5);

  testDistance("end is before start", "test1\ntest2", pos([2, 2], [1, 3]), -5);

  testDistance("start before text and end after is just the BOF to EOF", "test1\ntest2", pos([-1, -3], [5, 7]), 11);

  describe("shift(range.start, distance(range)) = range.end", () => {
    for (const range of [pos([1, 1], [2, 1]), pos([1, 2], [1, 2]), pos([1, 4], [1, 2])]) {
      const r = read("test1\ntest2");
      it(`range={[${range.start.line}, ${range.start.column}] -> [${range.end.line}, ${range.end.column}]}`, () => {
        const shifted = r.shift(range.start, r.distance(range));
        expect(shifted).toMatchObject(range.end);
      });
    }
  });
});