import {
  $,
  escape,
  load,
  save,
  toast,
  download,
  markdown,
  init,
  run,
  busy,
  resultMeta,
} from "./ui.js";
let sources = [];
let report = null;
let pending = false;
const draft = load("source-brief-v1", {});
if (Array.isArray(draft.sources)) sources = draft.sources;
for (const f of ["topic", "focus", "method"])
  if (typeof draft[f] === "string") $("#" + f).value = draft[f];
const safeUrl = (value) => {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
};
function renderSources() {
  $("#source-list").innerHTML = sources
    .map(
      (s, i) =>
        `<article class="card"><div class="row between"><strong>[S${i + 1}] ${escape(s.title)}</strong><button data-remove="${i}" class="small ghost danger" ${pending ? "disabled" : ""}>移除</button></div><p class="hint">${s.content.length.toLocaleString()} 字符</p></article>`,
    )
    .join("");
  $("#count").textContent = `${sources.length} / 10`;
  $("#source-editor").hidden = $("#method").value === "web";
  $("#web-note").hidden = $("#method").value !== "web";
}
function addSource(s) {
  if (!s.title.trim() || !s.content.trim())
    throw Error("来源标题和正文不能为空");
  if (s.url && !safeUrl(s.url))
    throw Error("来源网址必须是有效的 HTTP/HTTPS 地址");
  if (
    sources.length >= 10 ||
    sources.reduce((n, v) => n + v.content.length, 0) + s.content.length > 50000
  )
    throw Error("最多 10 份来源，总量 50,000 字符");
  sources.push(s);
  renderSources();
}
$("#source-form").onsubmit = (e) => {
  e.preventDefault();
  if (pending) return;
  try {
    addSource({
      title: $("#source-title").value.trim(),
      url: $("#source-url").value.trim(),
      content: $("#source-content").value.trim(),
    });
    e.target.reset();
  } catch (err) {
    toast(err.message, true);
  }
};
$("#source-list").onclick = (e) => {
  const b = e.target.closest("[data-remove]");
  if (b && !pending) {
    sources.splice(Number(b.dataset.remove), 1);
    renderSources();
  }
};
$("#method").onchange = renderSources;
$("#sample").onclick = () => {
  sources = [
    {
      title: "示例访谈 A · 独立设计师",
      url: "",
      content:
        "受访者每周整理一次客户需求，最重视离线访问、Markdown 导出和本地备份。愿意接受手动同步，但不希望为了查找旧笔记持续联网。",
    },
    {
      title: "示例访谈 B · 三人协作团队",
      url: "",
      content:
        "团队希望多人同时编辑并追溯修改记录，当前问题是文件版本冲突。成员愿意使用云端协作，但需要明确的访问权限和定期导出机制。",
    },
  ];
  $("#topic").value = "个人与小团队如何选择知识管理工具？";
  $("#focus").value = "比较离线需求、协作方式及需要补充验证的信息";
  $("#method").value = "sources";
  renderSources();
};
$("#save-draft").onclick = () => {
  if (
    save("source-brief-v1", {
      sources,
      topic: $("#topic").value,
      focus: $("#focus").value,
      method: $("#method").value,
    })
  )
    toast("研究草稿已保存");
};
function renderReport(data, meta) {
  let content;
  if (data.method === "web" && data.annotations.length) {
    const sorted = [...data.annotations]
      .filter(
        (a) =>
          Number.isInteger(a.start_index) &&
          Number.isInteger(a.end_index) &&
          a.start_index >= 0 &&
          a.end_index > a.start_index &&
          a.end_index <= data.report.length &&
          safeUrl(a.url),
      )
      .sort((a, b) => a.start_index - b.start_index);
    let end = 0;
    content = "";
    for (const a of sorted) {
      if (a.start_index < end) continue;
      content +=
        markdown(data.report.slice(end, a.start_index)) +
        `<a class="inline-citation" href="${escape(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${escape(data.report.slice(a.start_index, a.end_index) || a.title)}</a>`;
      end = a.end_index;
    }
    content += markdown(data.report.slice(end));
    if (!sorted.length)
      content += `<p>${data.sources.map((s) => `<a href="${escape(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">[${escape(s.title)}]</a>`).join(" · ")}</p>`;
  } else {
    content = markdown(data.report);
    for (const s of data.sources)
      content = content.replaceAll(
        `[${s.id}]`,
        `<a href="#cite-${escape(s.id)}">[${escape(s.id)}]</a>`,
      );
  }
  $("#report").innerHTML =
    `<div class="meta">${resultMeta(meta)}</div>${content}`;
  $("#citations").innerHTML =
    data.sources
      .map(
        (s) =>
          `<article class="card" id="cite-${escape(s.id)}"><div class="row"><span class="pill">${escape(s.id)}</span><strong>${safeUrl(s.url) ? `<a href="${escape(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${escape(s.title)} ↗</a>` : escape(s.title)}</strong></div><p class="source-text">${escape(s.excerpt)}</p></article>`,
      )
      .join("") || '<p class="muted">没有可展示的来源。</p>';
  $("#actions").hidden = false;
}
$("#research-form").onsubmit = async (e) => {
  e.preventDefault();
  if (pending) return;
  pending = true;
  busy($("#research"), true, "正在研究与核对…");
  document
    .querySelectorAll(
      "input,textarea,select,#source-form button,#sample,#save-draft",
    )
    .forEach((el) => (el.disabled = true));
  renderSources();
  try {
    const r = await run({
      topic: $("#topic").value,
      focus: $("#focus").value,
      method: $("#method").value,
      sources,
    });
    report = { ...r.data, mode: r.meta.mode };
    renderReport(r.data, r.meta);
  } catch (err) {
    toast(err.message, true);
  } finally {
    pending = false;
    busy($("#research"), false);
    document
      .querySelectorAll(
        "input,textarea,select,#source-form button,#sample,#save-draft",
      )
      .forEach((el) => (el.disabled = false));
    renderSources();
  }
};
$("#download").onclick = () => {
  if (report)
    download(
      "source-brief.md",
      `${report.report}\n\n## Sources\n\n` +
        report.sources
          .map(
            (s) =>
              `- [${s.id}] ${s.title}${s.url ? " — " + s.url : ""}\n  ${s.excerpt}`,
          )
          .join("\n"),
    );
};
$("#evidence").onclick = () => {
  if (report)
    download(
      "source-brief-evidence.json",
      JSON.stringify(report, null, 2),
      "application/json",
    );
};
await init();
renderSources();
