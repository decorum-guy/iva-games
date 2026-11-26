import type { AnchorHTMLAttributes, MouseEvent } from "react";

export type Page = "home" | "chess" | "games" | "login" | "friends" | "rooms" | "invitations" | "profile";
export type Route = { page: Page; roomId?: string; invitationId?: string };

export function readRoute(): Route {
  const url = new URL(window.location.href);
  // Keep previously shared room/invitation links working.
  const path = url.hash.startsWith("#/") ? url.hash.slice(1) : url.pathname;
  const bits = path.split("/").filter(Boolean);
  if (["invite", "invites", "invitations"].includes(bits[0] ?? "") && bits[1])
    return { page: "invitations", invitationId: bits[1] };
  if (bits[0] === "rooms") return { page: "rooms", roomId: bits[1] };
  if (["login", "verify", "reset"].includes(bits[0] ?? "")) return { page: "login" };
  return { page: ["chess", "games", "friends", "invitations", "profile"].includes(bits[0] ?? "")
    ? bits[0] as Page : "home" };
}

export function navigate(href: string, replace = false): void {
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function go(page: Page, roomId?: string, replace = false): void {
  navigate(page === "home" ? "/" : `/${page}${roomId ? `/${encodeURIComponent(roomId)}` : ""}`, replace);
}

export function PortalLink({ href = "/", onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      (props.target && props.target !== "_self") || props.download !== undefined) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    navigate(`${url.pathname}${url.search}${url.hash}`);
  };
  return <a {...props} href={href} onClick={follow} />;
}
