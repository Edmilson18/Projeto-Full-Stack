export function limparTokenDaUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("resetToken")) return;
  url.searchParams.delete("resetToken");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
