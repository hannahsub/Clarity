(function(){
  const host = location.hostname;
  const onGoogle = host === "www.google.com" || host.endsWith(".google.com") || host.endsWith(".google.com.au");
  const onBing   = host === "www.bing.com";

  if (!onGoogle && !onBing) return;

  const blockedHosts = [
    "chat.openai.com","chatgpt.com","platform.openai.com",
    "gemini.google.com","ai.google.dev","claude.ai","anthropic.com",
    "copilot.microsoft.com","bing.com","perplexity.ai",
    "poe.com","pi.ai","huggingface.co","meta.ai","bard.google.com"
  ];

  function shouldHide(url) {
    try {
      const u = new URL(url);
      return blockedHosts.some(h => u.hostname === h || u.hostname.endsWith("." + h)) ||
             (u.hostname === "www.bing.com" && /[?/#]chat\b/.test(url));
    } catch { return false; }
  }

  function cleanSERP() {
    document.querySelectorAll("a[href]").forEach(a => {
      if (shouldHide(a.href)) {
        const card = a.closest("div.g, div.MjjYud, div#search .tF2Cxc, .b_algo, li.b_algo");
        (card || a).style.display = "none";
      }
    });
  }

  const obs = new MutationObserver(cleanSERP);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  cleanSERP();
})();