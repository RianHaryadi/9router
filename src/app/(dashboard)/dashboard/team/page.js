"use client";

// The owner-only team page: the teammate list, their keys, and what each of
// them is spending.
//
// It is a page of its own (not a card in Settings) so the table has room:
// the usage panel of a teammate is four numbers wide.

import TeamMembersCard from "./components/TeamMembersCard";

export default function TeamPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-text-main">Team</h1>
        <p className="text-sm text-text-muted">
          Your teammates, the key each of them bills against, and what they have spent on it.
        </p>
      </div>
      <TeamMembersCard />
    </div>
  );
}
