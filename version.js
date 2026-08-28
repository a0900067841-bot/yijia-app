// Single source of truth for the deployed SC version.
window.YIJIA_BUILD = { app: "SC", version: "v5.5.0 SC Alpha 5.91", cloud: "Multi-Store Cloud" };
(function () {
  const b = window.YIJIA_BUILD;
  document.title = `億家 Enterprise SC ${b.version}`;
  const el = document.getElementById("appVersionLabel");
  if (el) el.textContent = `億家 SC・${b.version}・${b.cloud}`;
})();
