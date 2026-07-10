"use client";

import { signOut } from "next-auth/react";

export interface UserMenuProps {
  user?: { name?: string | null; image?: string | null } | null;
}

/** Header user menu: avatar + name + sign-out. Renders nothing when signed out. */
export function UserMenu({ user }: UserMenuProps) {
  if (!user) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt={user.name ?? "user"}
          width={24}
          height={24}
          style={{ borderRadius: "50%" }}
        />
      ) : null}
      <span>{user.name}</span>
      <button type="button" onClick={() => signOut({ redirectTo: "/signin" })}>
        Sign out
      </button>
    </div>
  );
}
