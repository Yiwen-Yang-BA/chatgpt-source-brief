import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../project.mjs";
import { ValidationError } from "../lib/validate.mjs";

const sources = [
  {
    id: "user-controlled",
    title: "项目更新",
    url: "https://example.com/update",
    content: "试点项目已完成第一轮测试。下一轮测试计划在十月进行。",
  },
];
const payload = {
  topic: "试点项目现状",
  focus: "测试进展",
  method: "sources",
  sources,
};
const demo = {
  mode: "demo",
  generate: async (spec) => {
    const value = await spec.demo();
    return typeof value.text === "string" ? value : { data: value };
  },
};
const modelReport = (changes = {}) => ({
  title: "项目简报",
  summary: "资料提供了测试进展。",
  findings: [
    {
      heading: "测试",
      body: "资料称第一轮测试已经完成。[S1]",
      citations: ["S1"],
      quotes: [{ sourceId: "S1", text: "试点项目已完成第一轮测试。" }],
    },
  ],
  gaps: ["仍需确认第二轮结果。"],
  ...changes,
});

test("sources demo organizes real excerpts and replaces user IDs with server IDs", async () => {
  const result = await run(payload, demo);
  assert.equal(result.method, "sources");
  assert.match(result.report, /本地演示整理，未调用模型/);
  assert.ok(result.report.includes(sources[0].content));
  assert.equal(result.sources[0].id, "S1");
  assert.equal(result.sources[0].excerpt, sources[0].content);
  assert.deepEqual(result.annotations, []);
  assert.ok(result.questions.length > 0);
});

test("source URLs are metadata only and invalid schemes or credentials are rejected", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => {
    throw new Error("User URL must never be fetched");
  });
  await run(
    {
      ...payload,
      sources: [{ ...sources[0], url: "http://127.0.0.1/private" }],
    },
    demo,
  );
  await run({ ...payload, sources: [{ ...sources[0], url: "" }] }, demo);
  for (const url of [
    "javascript:alert(1)",
    "file:///secret",
    "https://user:password@example.com",
    "not a URL",
  ])
    await assert.rejects(
      run({ ...payload, sources: [{ ...sources[0], url }] }, demo),
      ValidationError,
    );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("input limits reject invalid source counts, content, titles and topics before generation", async () => {
  for (const change of [
    { topic: "" },
    { topic: "x".repeat(1501) },
    { focus: "x".repeat(1501) },
    { method: "other" },
    { sources: [] },
    { sources: Array(11).fill(sources[0]) },
    { sources: [{ ...sources[0], content: "" }] },
    { sources: [{ ...sources[0], content: "x".repeat(12001) }] },
    { sources: [{ ...sources[0], title: "x".repeat(161) }] },
    {
      sources: Array.from({ length: 5 }, () => ({
        title: "n",
        content: "x".repeat(11000),
      })),
    },
  ])
    await assert.rejects(run({ ...payload, ...change }, demo), ValidationError);
});

test("source-mode model contract uses structured data and returns validated findings", async () => {
  let observed;
  const result = await run(payload, {
    mode: "live",
    generate: async (spec) => {
      observed = spec;
      return { data: modelReport() };
    },
  });
  assert.equal(observed.webSearch, undefined);
  assert.match(observed.instructions, /untrusted data/);
  assert.match(observed.instructions, /Do not fetch supplied URLs/);
  assert.equal(JSON.parse(observed.input).sources[0].id, "S1");
  assert.equal(observed.schema.additionalProperties, false);
  assert.ok(result.report.includes("[S1]"));
  assert.deepEqual(result.questions, ["仍需确认第二轮结果。"]);
});

test("unknown citations, empty finding citations, forged quotes and prose IDs are rejected", async () => {
  const original = modelReport().findings[0];
  for (const data of [
    modelReport({ findings: [{ ...original, citations: ["S99"] }] }),
    modelReport({ findings: [{ ...original, citations: [] }] }),
    modelReport({
      findings: [
        {
          ...original,
          quotes: [{ sourceId: "S1", text: "试点已经全面成功。" }],
        },
      ],
    }),
    modelReport({ summary: "伪造来源 [S99]" }),
    modelReport({ findings: [{ ...original, citations: ["S1", "S1"] }] }),
  ])
    await assert.rejects(
      run(payload, { mode: "live", generate: async () => ({ data }) }),
      ValidationError,
    );
});

test("web demo is explicitly offline and never supplies fake links or evidence", async () => {
  let observed;
  const result = await run(
    { topic: "最新项目消息", method: "web" },
    {
      mode: "demo",
      generate: async (spec) => {
        observed = spec;
        return spec.demo();
      },
    },
  );
  assert.equal(observed.webSearch, true);
  assert.equal(observed.schema, undefined);
  assert.match(result.report, /没有联网搜索/);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.annotations, []);
});

test("live web requests search, preserves citation positions and deduplicates source URLs", async () => {
  let observed;
  const result = await run(
    { topic: "项目发布", method: "web" },
    {
      mode: "live",
      generate: async (spec) => {
        observed = spec;
        return {
          text: "  项目已有发布消息。",
          annotations: [
            {
              type: "url_citation",
              url: "https://example.com/news#one",
              title: "新闻",
              start_index: 0,
              end_index: 5,
            },
            {
              type: "url_citation",
              url: "https://example.com/news#two",
              title: "新闻",
            },
            {
              type: "url_citation",
              url: "https://other.example/news",
              title: "其他来源",
            },
            { type: "url_citation", url: "javascript:alert(1)" },
          ],
        };
      },
    },
  );
  assert.equal(observed.webSearch, true);
  assert.equal(observed.schema, undefined);
  assert.equal(result.sources.length, 2);
  assert.ok(result.report.startsWith("  项目"));
  assert.equal(result.annotations.length, 3);
  assert.equal(result.annotations[0].start_index, 0);
  assert.equal(result.sources[0].excerpt, "");
  assert.equal(result.method, "web");
});

test("live web report is withheld when citations are missing or all invalid", async () => {
  for (const annotations of [
    undefined,
    [],
    [{ type: "url_citation", url: "file:///tmp/a" }],
    [{ type: "url_citation", url: "https://user:pass@example.com" }],
    [{ type: "not_a_citation", url: "https://example.com" }],
  ])
    await assert.rejects(
      run(
        { topic: "测试", method: "web" },
        {
          mode: "live",
          generate: async () => ({ text: "没有证据的报告", annotations }),
        },
      ),
      /缺少有效网页引用/,
    );
});
