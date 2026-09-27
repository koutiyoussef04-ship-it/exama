# Lecture audio & video — cost model and limits

Provider prices checked on 2026-09-26; plan prices and limits updated 2026-09-27 (three-tier catalog). Re-check them before launch and after any provider change.

- **Transcription:** AssemblyAI pre-recorded. Universal-3.5 Pro costs **$0.21/h** ($0.0035/min, 18 languages). Universal-2 costs **$0.15/h** ($0.0025/min, 99 languages including Arabic). Exama asks for Pro first and falls back to Universal-2, so the model below uses the higher price.
- **Knowledge extraction:** one Claude Sonnet 5 call per lecture, at **$2 per million input tokens and $10 per million output tokens**.
- **Assumptions:**
  - Speech runs at about 250 tokens per minute of lecture. That is conservative: English is about 200; French, Spanish and Arabic are higher.
  - Each call adds about 1,000 prompt tokens.
  - Output ranges from about 1.5k tokens for a short lecture to 6k for a 2-hour one (capped at 8k).
  - If the model's answer is unusable, the call is retried once. Rare, but it doubles the AI cost of that lecture.
- **Storage and processing:**
  - Recordings are deleted as soon as they are transcribed, so storage is effectively €0.
  - Reading the file header uses no ffmpeg or encoding, so server CPU is negligible.
  - The only real cost is outbound traffic to AssemblyAI, at about $0.09/GB on a typical cloud host (many hosts include it). That's about 0.5 MB/min for audio and 8 MB/min for 720p video.

## Cost per lecture (USD, worst case)

| Lecture | Transcription | AI extraction | Storage + traffic (audio / video) | **Total audio** | **Total video** |
|---|---|---|---|---|---|
| 10 min | $0.035 | $0.022 | $0.0004 / $0.007 | **$0.06** | **$0.06** |
| 30 min | $0.105 | $0.047 | $0.001 / $0.021 | **$0.15** | **$0.17** |
| 60 min | $0.21 | $0.077 | $0.003 / $0.042 | **$0.29** | **$0.33** |
| 120 min | $0.42 | $0.122 | $0.005 / $0.084 | **$0.55** | **$0.63** |

With Universal-2 only (`ASSEMBLYAI_SPEECH_MODELS=universal-2`), transcription is 29% cheaper: $0.15/h instead of $0.21/h.

Once processed, the lecture's text joins the course. Exams, practice and the planner already send a fixed-size excerpt, so later AI calls don't get bigger.

## Compared with the subscription price

Revenue per month after about 20% VAT and the store's commission (App Store and Google Play both take 15% on subscriptions for most small developers, 30% otherwise):

| Plan | Price / month | After VAT + 15% | After VAT + 30% |
|---|---|---|---|
| Basic monthly | €9.99 | €7.08 | €5.83 |
| Basic yearly (€79.99) | €6.67 | €4.72 | €3.89 |
| Student monthly | €14.99 | €10.62 | €8.74 |
| Student yearly (€119.99) | €10.00 | €7.08 | €5.83 |
| Pro monthly | €24.99 | €17.70 | €14.58 |
| Pro yearly (€199.99) | €16.67 | €11.80 | €9.72 |

Lecture cost when a student uses the **whole** monthly allowance in 60-minute lectures ($1 ≈ €0.91):

| Plan | Lecture limit | Cost at the limit (audio – video) | Share of net revenue, 15% commission (monthly / yearly) |
|---|---|---|---|
| Free | **1 lecture per account**, ≤ 45 min, never renewed | ≈ €0.21, once | — (acquisition cost) |
| Basic | **none** (PDFs and PowerPoints only) | €0 | 0% |
| Trial | 1 lecture, ≤ 30 min, whole trial | ≈ €0.14 | — (acquisition cost) |
| Student | 30 lectures, **300 min**, ≤ 120 min each | €1.32 – €1.50 | 12–14% / 19–21% |
| Pro | 80 lectures, **720 min**, ≤ 180 min each | €3.17 – €3.60 | 18–20% / 27–31% |

Free's lecture is a one-time allowance, not a monthly one: for the `free` tier the API counts lecture uploads and minutes over the account's whole history (the ledger is append-only), so deleting the course, re-uploading the same file or waiting a month gives nothing back. The 45 minutes are checked and reserved before transcription, and the transcription provider is capped at them.

These are the default limits in `apps/api/src/billing/limits.ts`. You can change them without a deploy using `PLAN_LIMITS_OVERRIDE` (and which tiers may upload lectures at all with `PLAN_FEATURES_OVERRIDE`).

1. **Sizing:** the limits keep the **yearly** plans, which bring the least per month, profitable even for a student who uses every minute. Most students won't come near the limit. Pro gets 2.4× Student's minutes; 900 minutes would take about 34–38% of Pro yearly revenue at the limit.
2. **PowerPoints** cost the same as PDFs: text extraction runs on the server (no paid service), then the same single Claude analysis.
3. **Other features:** exams, practice, study plans and PDFs/PowerPoints have their own limits and costs. A student who maxes out *everything* on a yearly plan could cost more than they pay — Basic yearly is the tightest (≈ €4.72 net): its caps (10 uploads, 15 exams, 120 practice questions, 3 plans) cost roughly €1.1–2.6 at the limit. Watch real usage with `npm run analytics:report` (it now splits the monetization funnel by Basic / Student / Pro) and your provider invoices.
4. **If margins look tight, in this order:**
   - use Universal-2 only (−29% on transcription);
   - lower Pro's `mediaMinutesPerMonth` (e.g. 600) or Student's (e.g. 240);
   - lower Basic's exam/practice caps.
5. **Worst case per file:** no file can be longer than `MEDIA_MAX_MINUTES_PER_FILE` (240 min by default), whatever the plan, the owner account included. The transcription provider is told to stop at the reserved length (`audio_end_at`), so a file whose header lies about its length can't cost more than was charged.
