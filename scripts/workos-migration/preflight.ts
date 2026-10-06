export interface PreflightIssue {
  email: string;
  reason:
    | "invalid_email"
    | "duplicate_email"
    | "duplicate_owner"
    | "duplicate_mapping"
    | "duplicate_provider_identity"
    | "duplicate_provider_email"
    | "invalid_provider_email"
    | "provider_email_collision"
    | "external_id_mismatch";
  teakUserIds: string[];
  workosUserId?: string;
}
export interface PreflightOwner {
  deleted: boolean;
  email: string;
  passwordFormat: "none" | "compatible" | "unsupported";
  teakUserId: string;
  workosUserId: string | null;
}
export interface PreflightProvider {
  email: string;
  externalId: string | null;
  id: string;
}
export function preflight(
  owners: PreflightOwner[],
  providers: PreflightProvider[],
  delta = false
) {
  const normalized = (value: string) => value.trim().toLowerCase();
  const emails = new Map<string, PreflightOwner[]>(),
    ownerIds = new Map<string, number>(),
    ownerRows = new Map<string, PreflightOwner[]>(),
    providerIds = new Map<string, PreflightOwner[]>();
  const issues: PreflightIssue[] = [];
  const passwords = { none: 0, compatible: 0, unsupported: 0 };
  for (const owner of owners) {
    const email = normalized(owner.email);
    // Deleted owners erase their address. Keep their owner/mapping fences,
    // but an erased address cannot occupy the live email namespace.
    if (!(owner.deleted && email === "")) {
      const group = emails.get(email) ?? [];
      group.push(owner);
      emails.set(email, group);
    }
    ownerIds.set(owner.teakUserId, (ownerIds.get(owner.teakUserId) ?? 0) + 1);
    ownerRows.set(owner.teakUserId, [
      ...(ownerRows.get(owner.teakUserId) ?? []),
      owner,
    ]);
    if (owner.workosUserId) {
      const rows = providerIds.get(owner.workosUserId) ?? [];
      rows.push(owner);
      providerIds.set(owner.workosUserId, rows);
    }
    if (!owner.deleted) {
      passwords[owner.passwordFormat]++;
    }
  }
  for (const [email, rows] of emails) {
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      issues.push({
        reason: "invalid_email",
        email,
        teakUserIds: rows.map((row) => row.teakUserId),
      });
    }
    if (rows.length > 1) {
      issues.push({
        reason: "duplicate_email",
        email,
        teakUserIds: rows.map((row) => row.teakUserId),
      });
    }
  }
  for (const [id, count] of ownerIds) {
    if (count > 1) {
      issues.push({ reason: "duplicate_owner", email: "", teakUserIds: [id] });
    }
  }
  for (const [id, rows] of providerIds) {
    if (rows.length > 1) {
      issues.push({
        reason: "duplicate_mapping",
        email: "",
        teakUserIds: rows.map((row) => row.teakUserId),
        workosUserId: id,
      });
    }
  }
  const providerEmails = new Map<string, PreflightProvider[]>();
  const remoteIds = new Set<string>(),
    externalIds = new Set<string>();
  for (const provider of providers) {
    const address = normalized(provider.email);
    const group = providerEmails.get(address) ?? [];
    group.push(provider);
    providerEmails.set(address, group);
    if (
      remoteIds.has(provider.id) ||
      (provider.externalId && externalIds.has(provider.externalId))
    ) {
      issues.push({
        reason: "duplicate_provider_identity",
        email: address,
        teakUserIds: provider.externalId ? [provider.externalId] : [],
        workosUserId: provider.id,
      });
    }
    remoteIds.add(provider.id);
    if (provider.externalId) {
      externalIds.add(provider.externalId);
    }
  }
  for (const [address, group] of providerEmails) {
    if (group.length > 1 || !/^[^\s@]+@[^\s@]+$/.test(address)) {
      issues.push({
        reason:
          group.length > 1
            ? "duplicate_provider_email"
            : "invalid_provider_email",
        email: address,
        teakUserIds: group.flatMap((row) =>
          row.externalId ? [row.externalId] : []
        ),
      });
    }
  }
  for (const provider of providers) {
    const email = normalized(provider.email),
      matches = emails.get(email) ?? [];
    const externalOwners = provider.externalId
      ? (ownerRows.get(provider.externalId) ?? [])
      : [];
    const externalOwner =
      externalOwners.length === 1 ? externalOwners[0] : null;
    const expected = Boolean(
      externalOwner &&
        (!externalOwner.workosUserId ||
          externalOwner.workosUserId === provider.id) &&
        ((externalOwner.deleted &&
          normalized(externalOwner.email) === "" &&
          externalOwner.workosUserId === provider.id) ||
          (normalized(externalOwner.email) !== "" &&
            (delta || normalized(externalOwner.email) === email))) &&
        (matches.length === 0 ||
          (matches.length === 1 &&
            matches[0].teakUserId === externalOwner.teakUserId))
    );
    if (matches.length && !expected) {
      issues.push({
        reason: "provider_email_collision",
        email,
        teakUserIds: matches.map((row) => row.teakUserId),
        workosUserId: provider.id,
      });
    }
    if (provider.externalId && ownerIds.has(provider.externalId) && !expected) {
      issues.push({
        reason: "external_id_mismatch",
        email,
        teakUserIds: [provider.externalId],
        workosUserId: provider.id,
      });
    }
  }
  return {
    ownerRows: owners.length,
    providerRows: providers.length,
    passwords,
    issues,
    clear: issues.length === 0,
  };
}
