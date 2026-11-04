/* AXBI CRM: incorpora o formulário de captação em qualquer site.
   Uso: <div data-axbi-crm-form="axbi-crm" data-campanha="site"></div>
        <script src="https://SEU-CRM/embed.js" async></script> */
(function () {
  var script = document.currentScript;
  var base = script ? new URL(script.src).origin : "";
  var page = new URLSearchParams(location.search);
  document.querySelectorAll("[data-axbi-crm-form]").forEach(function (el) {
    if (el.dataset.axbiLoaded) return;
    el.dataset.axbiLoaded = "1";
    var campaign = page.get("utm_campaign") || el.getAttribute("data-campanha") || "site";
    var frame = document.createElement("iframe");
    frame.src = base + "/f/" + encodeURIComponent(el.getAttribute("data-axbi-crm-form")) +
      "?campanha=" + encodeURIComponent(campaign);
    frame.title = "Formulário de contato";
    frame.loading = "lazy";
    frame.style.cssText = "width:100%;border:0;min-height:560px;display:block;background:transparent";
    window.addEventListener("message", function (e) {
      if (e.origin === base && e.source === frame.contentWindow && e.data && e.data.type === "axbi-crm-form-height") {
        frame.style.height = e.data.height + "px";
        frame.style.minHeight = "0";
      }
    });
    el.appendChild(frame);
  });
})();
