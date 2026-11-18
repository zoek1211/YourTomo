// GitHub GraphQL fetches (token required). Zero dependencies.
// GraphQL works with fine-grained tokens for these queries, unlike some
// user-level REST endpoints - so this is the reliable channel in CI.

export interface CalendarDay { date: string; count: number }
export interface Calendar { total: number; days: CalendarDay[] }

const CALENDAR_QUERY = (user: string) => `{
  user(login: \"${user}\") {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

const ACTIVITY_QUERY = (user: string) => `{
  user(login: \"${user}\") {
    repositories(first: 15, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes { name pushedAt }
    }
    pullRequests(first: 10, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { mergedAt }
    }
  }
}`;

async function post(query: string, token: string): Promise<any | null> {
    const resp = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `bearer ${token}`, "User-Agent": "github-pet" },
        body: JSON.stringify({ query }),
    });
    if (!resp.ok) {
        console.error(`GraphQL ${resp.status}`);
        return null;
    }
    const payload: any = await resp.json();
    // errors are non-fatal — GitHub sometimes returns data alongside them
    if (payload?.errors) {
        console.error(`GraphQL errors (count: ${payload.errors.length})`);
    }
    return payload?.data ?? null;
}

export async function fetchCalendar(token: string | undefined, user = "prsdx"): Promise<Calendar | null> {
    if (!token) { console.error("fetchCalendar: no token provided"); return null; }
    try {
        const data = await post(CALENDAR_QUERY(user), token);
        if (!data) throw new Error("GraphQL returned no data (check token scopes: needs read:user or Metadata read)");
        const cal = data.user.contributionsCollection.contributionCalendar;
        const days: CalendarDay[] = [];
        for (const week of cal.weeks) {
            for (const d of week.contributionDays) days.push({ date: d.date, count: d.contributionCount });
        }
        return { total: cal.totalContributions, days };
    } catch (err: any) {
        console.error("fetchCalendar failed:", err?.message ?? err);
        return null;
    }
}

export async function fetchActivity(token: string | undefined, user = "prsdx", ignored: Set<string> = new Set([user.toLowerCase()])):
    Promise<{ lastPush: Date | null; lastPushRepo: string | null; merged24h: number } | null> {
    if (!token) { console.error("fetchActivity: no token provided"); return null; }
    try {
        const data = await post(ACTIVITY_QUERY(user), token);
        const u = data.user;
        // skip ignored repos (lowercased short names), e.g. the profile repo
        // the pet workflow commits to every run, which would keep the cat fed forever
        const repos: Array<{ name: string; t: Date }> = u.repositories.nodes
            .filter((n: any) => !ignored.has(String(n.name ?? "").toLowerCase()))
            .map((n: any) => ({ name: String(n.name ?? ""), t: new Date(n.pushedAt) }))
            .filter((r: { t: Date }) => !isNaN(r.t.getTime()))
            .sort((a: { t: Date }, b: { t: Date }) => b.t.getTime() - a.t.getTime());
        const pushed: Date[] = repos.map((r) => r.t);
        const now = Date.now();
        let merged = 0;
        for (const n of u.pullRequests.nodes) {
            const t = new Date(n.mergedAt);
            if (!isNaN(t.getTime()) && now - t.getTime() <= 24 * 3600e3) merged++;
        }
        const lastPush = pushed.length ? new Date(Math.max(...pushed.map((t) => t.getTime()))) : null;
        return { lastPush, lastPushRepo: repos[0]?.name ?? null, merged24h: merged };
    } catch {
        return null;
    }
}