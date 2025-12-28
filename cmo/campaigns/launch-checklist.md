# Launch Checklist

*Pre-launch and launch day tasks for Teak.*

---

## Pre-Launch (2 weeks out)

### Product Readiness

- [ ] **Feature complete** — All planned features are implemented
- [ ] **Bugs fixed** — Critical bugs resolved, known issues documented
- [ ] **Performance acceptable** — Page loads < 3s, AI processing completes in reasonable time
- [ ] **Analytics installed** — Vercel Analytics, Plausible, or similar
- [ ] **Error tracking** — Sentry or similar is set up
- [ ] **Rate limiting** — Protect against abuse while allowing free tier usage
- [ ] **Database tested** — Convex deployment is stable
- [ ] **Backup/restore** — Data backup strategy is in place

### Marketing Assets

- [ ] **Landing page updated** — Hero copy, features, CTA using cmo/landing-page/ content
- [ ] **Screenshots ready** — High-res product screenshots (2x/3x), showing:
  - [ ] Masonry grid view
  - [ ] Multiple card types
  - [ ] Search in action
  - [ ] Browser extension
  - [ ] Mobile app
- [ ] **Demo video/GIF** — 15-30 second loop showing key workflow
- [ ] **Feature comparison** — Teak vs competitors table ready
- [ ] **One-pager** — Sales one-pager ready (cmo/sales/one-pager.md)
- [ ] **Press kit** — Folder with logos, screenshots, boilerplate

### Content & Copy

- [ ] **Announcement posts written** — For all platforms (Twitter, LinkedIn, etc.)
- [ ] **Launch thread prepared** — "Why I Built Teak" thread ready
- [ ] **Blog post** — Launch announcement or "Why I built Teak"
- [ ] **FAQ** — Common questions answered (cmo/sales/objections.md)
- [ ] **Documentation updated** — Features page accurate and up to date

### Outreach Preparation

- [ ] **Press list compiled** — Tech/design writers who might care
- [ ] **Beta testers notified** — Give them heads up about launch
- [ ] **Friends/colleagues list** — People who will upvote/comment
- [ ] **Newsletter draft** — Launch email to any existing list
- [ ] **Discord/Slack communities** — List of relevant communities to share in

---

## Launch Day

### Morning (9 AM - 12 PM PT)

**Product Launch**
- [ ] **Deploy to production** — Push latest code, verify everything works
- [ ] **Smoke test** — Create account, save card, search, view
- [ ] **Monitor for issues** — Watch logs, Convex dashboard

**Initial Announcements**
- [ ] **Tweet** — Main launch tweet with link
- [ ] **Launch thread** — Post the pre-written thread
- [ ] **LinkedIn** — Share with professional network
- [ ] **Bluesky** — Cross-post for early adopter crowd

**Early Engagement**
- [ ] **Monitor mentions** — Reply to every comment/mention
- [ ] **Thank early signups** — Personal touch when possible
- [ ] **Watch for bugs** — Users will find them immediately

### Afternoon (12 PM - 5 PM PT)

**Product Hunt**
- [ ] **Submit to Product Hunt** — Fill out listing with good copy/images
- [ ] **First comment** — Engaging comment on your own post
- [ ] **Engage with other hunts** — Upvote/comment on other launches

**Community Posts**
- [ ] **Hacker News** — Submit to "Show HN" with good title
- [ ] **Reddit** — Post to relevant subs (r/SideProject, r/webdev)
- [ ] **Indie Hackers** — Share in "Launch" section

**Ongoing**
- [ ] **Monitor metrics** — Signups, cards created, errors
- [ ] **Reply to comments** — Every single one, quickly
- [ ] **Fix critical bugs** — Hotfix if necessary

### Evening (5 PM - 10 PM PT)

- [ ] **Recap tweet** — Share day 1 metrics if going well
- [ ] **Thank supporters** — Call out people who helped spread the word
- [ ] **Final status check** — Everything stable?

---

## Day +1 (The Day After)

### Follow-up

- [ ] **Share metrics** — Day 1 stats (signups, cards saved, etc.)
- [ ] **Thank you posts** — Public thanks to community
- [ ] **Product Hunt follow-up** — Engage with comments on your listing
- [ ] **HN follow-up** — Reply to comments on Show HN post
- [ ] **Reddit follow-up** — Reply to comments, answer questions

### Learn

- [ ] **Collect feedback** — What people loved/hated
- [ ] **Document bugs** — Issues users found
- [ ] **Feature requests** — Track what people want
- [ ] **Analyze metrics** — What channels drove signups?

---

## Launch Channels

### Primary Channels (Must Do)

| Channel | Purpose | Timing |
|---------|---------|--------|
| **Product Hunt** | Tech/early adopter audience | 12:01 AM PT on launch day |
| **Hacker News** | Developer/technical | Morning PT (8-10 AM) |
| **Twitter/X** | Main announcement + thread | Morning PT |
| **LinkedIn** | Professional network | Morning PT |
| **GitHub** | Update repo with launch notes | After launch confirmed |

### Secondary Channels (Nice to Have)

| Channel | Purpose | Notes |
|---------|---------|-------|
| **Reddit - r/SideProject** | Supportive indie community | Follow subreddit rules |
| **Reddit - r/webdev** | Web developers | |
| **Indie Hackers** | Founder community | |
| **Bluesky** | Early adopter creative crowd | |

---

## Copy Templates

### Product Hunt

**Title:** Teak – Visual bookmarking with AI-powered rediscovery

**Tagline:** Capture inspiration from anywhere. Let AI organize it. Find it effortlessly.

**Description:**
Your bookmarks are where links go to die. Teak is where they come back to life.

Capture articles, designs, videos, and more from any page. Teak's AI automatically tags, categorizes, and summarizes—so you can actually find what you saved when you need it.

**Key features:**
- One-click browser extension
- AI auto-tagging and summarization
- Beautiful masonry grid layout
- Powerful search across everything
- Works on web, mobile, and browser

Open source and privacy-first.

---

### Hacker News (Show HN)

**Title:**
```
Show HN: I built Teak – An open-source, AI-powered bookmarking tool that actually helps you find what you've saved
```

**Description:**
```
Hey HN,

I built Teak because I was tired of saving things and never finding them again. Browser bookmarks are a graveyard—you save things with good intentions, then forget they exist.

Teak is a visual bookmarking tool with AI:
- Save from any page with one click
- AI automatically tags, categorizes, and summarizes
- Beautiful masonry grid (not a list)
- Powerful search across content, tags, and summaries

It's open source (MIT), privacy-first, and built with Next.js, Convex, and React Native.

Would love your feedback: teakvault.com

GitHub: github.com/praveenjuge/teak-convex-nextjs
```

---

### Launch Tweet

```
Your bookmarks are where links go to die. Teak is where they come back to life.

Capture inspiration from anywhere. AI automatically organizes everything. Find it when you need it.

teakvault.com

🧵 A thread on why I built it 👇
```

---

### LinkedIn

```
I'm excited to share Teak — a visual bookmarking tool I've been working on.

The problem: I save hundreds of things but can never find them later. Browser bookmarks are a graveyard.

The solution: Teak uses AI to automatically organize everything you save. One-click capture, auto-tagging, and powerful search.

It's open source, privacy-first, and works across web, mobile, and browser.

teakvault.com
```

---

## Metrics to Track

### Day 1 Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Product Hunt upvotes | 100+ | ___ |
| Twitter impressions | 10,000+ | ___ |
| Signups | 100+ | ___ |
| Cards created | 500+ | ___ |
| HN upvotes | 50+ | ___ |
| Active users (Day 1) | 30%+ | ___ |

### Week 1 Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Total signups | 500+ | ___ |
| Active users | 40%+ | ___ |
| Retention (Day 7) | 20%+ | ___ |
| Stars on GitHub | 100+ | ___ |
| Social mentions | 50+ | ___ |

---

## Launch Day Tips

### Do's

- Reply to every comment — engagement boosts visibility
- Be authentic — people respond to genuine builders
- Share metrics — people love numbers
- Admit mistakes — if something breaks, own it
- Thank supporters — publicly appreciate help

### Don'ts

- Don't spam — one post per community
- Don't argue — polite disagreement, move on
- Don't overpromise — don't commit to features you can't deliver
- Don't ignore feedback — even criticism is valuable
- Don't disappear — stay engaged throughout launch day

---

## Emergency Contacts

| Issue | Contact |
|-------|---------|
| Technical issues | @praveenjuge |
| Press inquiries | hello@teakvault.com |
| Support | GitHub Issues |

---

*Good luck with the launch! Remember: shipping is better than perfect.*
