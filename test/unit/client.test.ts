import * as assert from "assert";
import { extractNextData, flattenConnection } from "../../src/api/queraClient";

describe("extractNextData", () => {
  it("parses the __NEXT_DATA__ script", () => {
    const html =
      '<html><body><script id="__NEXT_DATA__" type="application/json">' +
      '{"buildId":"B1","props":{"pageProps":{"x":1}}}</script></body></html>';
    const data = extractNextData(html);
    assert.strictEqual(data.buildId, "B1");
    assert.strictEqual(data.props.pageProps.x, 1);
  });

  it("returns undefined when absent", () => {
    assert.strictEqual(extractNextData("<html></html>"), undefined);
  });

  it("returns undefined on malformed JSON", () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{bad json}</script>';
    assert.strictEqual(extractNextData(html), undefined);
  });
});

describe("flattenConnection", () => {
  it("flattens a Relay connection", () => {
    const conn = { totalCount: 2, edges: [{ node: { pk: 1 } }, { node: { pk: 2 } }] };
    const out = flattenConnection(conn);
    assert.strictEqual(out.total, 2);
    assert.deepStrictEqual(out.items.map((n: any) => n.pk), [1, 2]);
  });

  it("passes non-connections through unchanged", () => {
    assert.deepStrictEqual(flattenConnection({ a: 1 }), { a: 1 });
    assert.strictEqual(flattenConnection(null), null);
  });
});
