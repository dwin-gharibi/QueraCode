import * as assert from "assert";
import {
  extractNextData,
  flattenConnection,
  normalizeProblem,
  parseProblemUrl,
} from "../../src/api/queraClient";

describe("parseProblemUrl", () => {
  it("parses problemset URLs and bare ids", () => {
    assert.deepStrictEqual(parseProblemUrl("https://quera.org/problemset/316836"), {
      kind: "problemset",
      problemId: 316836,
    });
    assert.deepStrictEqual(parseProblemUrl("316836"), { kind: "problemset", problemId: 316836 });
  });

  it("parses course/contest assignment URLs", () => {
    assert.deepStrictEqual(
      parseProblemUrl("https://quera.org/course/assignments/4367/problems/306549"),
      { kind: "assignment", assignmentId: 4367, problemId: 306549, area: "course" }
    );
    assert.deepStrictEqual(
      parseProblemUrl("https://quera.org/contest/assignments/98478/problems/152481"),
      { kind: "assignment", assignmentId: 98478, problemId: 152481, area: "contest" }
    );
  });

  it("rejects garbage", () => {
    assert.strictEqual(parseProblemUrl("not a url"), undefined);
    assert.strictEqual(parseProblemUrl(""), undefined);
  });
});

describe("normalizeProblem", () => {
  it("coerces GraphQL string ids to numbers everywhere", () => {
    const p = normalizeProblem({
      pk: "316836",
      assignment: { pk: "4367" },
      allowed_file_types: [{ id: "64", label: "Zip" }],
      tags: [{ id: "77", name: "Django" }],
      submissions: { items: [{ pk: "999" }] },
    } as any);
    assert.strictEqual(p.pk, 316836);
    assert.strictEqual(p.assignment.pk, 4367);
    assert.strictEqual(p.allowed_file_types[0].id, 64);
    assert.strictEqual(p.tags[0].id, 77);
    assert.strictEqual(p.submissions.items[0].pk, 999);
  });

  it("leaves non-numeric values alone", () => {
    const p = normalizeProblem({ pk: "abc", tags: [{ id: "x1" }] } as any);
    assert.strictEqual(p.pk, "abc");
    assert.strictEqual(p.tags[0].id, "x1");
  });
});

describe("contest/classes payload parsing", () => {
  it("flattens the /course classes connection", () => {
    const conn = flattenConnection({
      totalCount: 63,
      edges: [{ node: { id: 10, name: "Compiler" } }, { node: { id: 11, name: "AI" } }],
    });
    assert.strictEqual(conn.total, 63);
    assert.strictEqual(conn.items.length, 2);
  });

  it("extracts __NEXT_DATA__ with contest lists", () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({
        props: { pageProps: { activeFeaturedContests: [{ assignment: 98478, contest: { title: "Algocup" } }], finishedContests: [] } },
        buildId: "B",
      }) +
      "</script>";
    const data = extractNextData(html);
    assert.strictEqual(data.props.pageProps.activeFeaturedContests[0].assignment, 98478);
  });
});
