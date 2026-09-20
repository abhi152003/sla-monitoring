import { describe, expect, it } from "vitest";
import { CsvSyntaxError, parseCsv, stripBom } from "./csv";

describe("parseCsv", () => {
  it("parses simple comma-separated rows with LF endings", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF and lone-CR endings", () => {
    expect(parseCsv("a,b\r\n1,2\r3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles a final row without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("parses quoted fields containing commas", () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual([
      ["a", "b"],
      ["x,y", "2"],
    ]);
  });

  it("parses escaped quotes (RFC 4180 double-quote)", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  it("parses quoted fields spanning newlines", () => {
    expect(parseCsv('a\n"line1\nline2"')).toEqual([["a"], ["line1\nline2"]]);
  });

  it("preserves spaces inside and around unquoted fields as-is", () => {
    expect(parseCsv("a, b ,c\n1, 2,3")).toEqual([
      ["a", " b ", "c"],
      ["1", " 2", "3"],
    ]);
  });

  it("skips blank trailing lines", () => {
    expect(parseCsv("a,b\n1,2\n\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips interior blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps rows with empty fields (not blank records)", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("throws CsvSyntaxError on an unterminated quote", () => {
    expect(() => parseCsv('a,b\n"unterminated,2')).toThrow(CsvSyntaxError);
  });

  it("throws CsvSyntaxError on junk after a closing quote", () => {
    expect(() => parseCsv('a\n"x"junk')).toThrow(CsvSyntaxError);
  });

  it("strips a UTF-8 BOM via stripBom", () => {
    expect(stripBom("\ufeffa,b")).toBe("a,b");
    expect(stripBom("a,b")).toBe("a,b");
  });
});
