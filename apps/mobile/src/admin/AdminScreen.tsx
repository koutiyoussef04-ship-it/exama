/**
 * Owner-only admin dashboard (web and app). Internal tool: English only, read-only.
 * The server enforces owner access on every /admin endpoint; this screen only displays what it returns.
 * Every figure is labelled with its source — Database, Stripe (live), Analytics or Estimate — and
 * missing data is shown as unavailable with the reason, never as 0.
 */
import type {
  AdminAIReport,
  AdminAnalyticsReport,
  AdminBillingReport,
  AdminCategory,
  AdminCustomer,
  AdminCustomerAI,
  AdminCustomerDetail,
  AdminCustomerSort,
  AdminUsageWindow,
  AdminCustomersPage,
  AdminHealth,
  AdminOverview,
  AdminRange,
  AdminSource,
  Point,
  StripeMoney,
  StripeSummary,
  Tier,
} from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Chips } from '@/components/planner';
import { Badge, Body, Button, Card, colors, ErrorState, Loading, Screen, SectionLabel, space, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { eventDetails } from './event-details';

type Tab = 'overview' | 'customers' | 'ai' | 'billing' | 'analytics' | 'health';
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'customers', label: 'Customers' },
  { value: 'ai', label: 'AI costs' },
  { value: 'billing', label: 'Billing' },
  { value: 'analytics', label: 'Product' },
  { value: 'health', label: 'Health' },
];
const RANGES: { value: AdminRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];
const SOURCE_LABEL: Record<AdminSource, string> = { database: 'Database', stripe: 'Stripe · live', analytics: 'Analytics', estimate: 'Estimate' };
const SOURCE_TONE = { database: 'neutral', stripe: 'success', analytics: 'primary', estimate: 'warning' } as const;

// ---------------------------------------------------------------- formatting

const int = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-GB'));
const money = (cents: number | null | undefined, currency: string) =>
  cents == null ? 'unknown' : (cents / 100).toLocaleString('en-GB', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2 });
const dollars = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`);
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');
const percent = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const openUrl = (url: string) => void Linking.openURL(url);

// ---------------------------------------------------------------- small building blocks

function SourceBadge({ source }: { source: AdminSource }) {
  return <Badge label={SOURCE_LABEL[source]} tone={SOURCE_TONE[source]} />;
}
function Unavailable({ reason }: { reason: string }) {
  return (
    <View style={{ gap: space(1) }}>
      <Badge label="Unavailable" tone="danger" />
      <Body muted style={{ fontSize: 13 }}>{reason}</Body>
    </View>
  );
}
function Section({ title, source, children, note }: { title: string; source?: AdminSource; children: ReactNode; note?: string }) {
  return (
    <Card style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
        <SectionLabel>{title}</SectionLabel>
        {source && <SourceBadge source={source} />}
      </View>
      {children}
      {note && <Body muted style={{ fontSize: 12 }}>{note}</Body>}
    </Card>
  );
}
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={{ minWidth: 140, flexGrow: 1, flexBasis: 140, padding: space(3), borderRadius: 10, backgroundColor: colors.bg, gap: space(1) }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
      {hint && <Text style={{ color: colors.muted, fontSize: 11 }}>{hint}</Text>}
    </View>
  );
}
const Stats = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>{children}</View>;
function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(3), paddingVertical: space(1) }}>
      <Text style={{ color: colors.muted, fontSize: 14, flexShrink: 1 }}>{k}</Text>
      {typeof v === 'string' || typeof v === 'number' ? <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right' }}>{v}</Text> : v}
    </View>
  );
}
/** Horizontal bars: accessible as a list of "bucket: value" lines. */
function Bars({ points, format = int }: { points: Point[]; format?: (n: number) => string }) {
  if (!points.length) return <Body muted style={{ fontSize: 13 }}>No data in this range.</Body>;
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <View style={{ gap: space(1) }} accessibilityRole="list">
      {points.map((p) => (
        <View key={p.bucket} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }} accessibilityLabel={`${p.bucket}: ${format(p.count)}`}>
          <Text style={{ width: 84, color: colors.muted, fontSize: 12 }}>{p.bucket}</Text>
          <View style={{ flex: 1, height: 10, backgroundColor: colors.bg, borderRadius: 5 }}>
            <View style={{ width: `${Math.max(2, (p.count / max) * 100)}%`, height: 10, backgroundColor: colors.primary, borderRadius: 5 }} />
          </View>
          <Text style={{ width: 64, textAlign: 'right', color: colors.text, fontSize: 12 }}>{format(p.count)}</Text>
        </View>
      ))}
    </View>
  );
}
function Table({ columns, rows, onRowPress }: { columns: string[]; rows: (string | ReactNode)[][]; onRowPress?: (i: number) => void }) {
  if (!rows.length) return <Body muted style={{ fontSize: 13 }}>Nothing to show.</Body>;
  const cell = (c: string | ReactNode, j: number, header = false) => (
    <View key={j} style={{ flex: j === 0 ? 2 : 1, minWidth: 90, paddingVertical: space(1.5), paddingRight: space(2) }}>
      {typeof c === 'string' ? <Text style={{ fontSize: 13, color: header ? colors.muted : colors.text, fontWeight: header ? '600' : '400' }} numberOfLines={2}>{c}</Text> : c}
    </View>
  );
  // Scrolls sideways when the columns don't fit (narrow screens, wide tables) instead of overflowing the card.
  return (
    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minWidth: (columns.length + 1) * 90 }}>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border }}>{columns.map((c, j) => cell(c, j, true))}</View>
      {rows.map((r, i) => {
        const content = <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border }}>{r.map((c, j) => cell(c, j))}</View>;
        return onRowPress ? (
          <Pressable key={i} onPress={() => onRowPress(i)} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.6 }}>
            {content}
          </Pressable>
        ) : (
          <View key={i}>{content}</View>
        );
      })}
      </View>
    </ScrollView>
  );
}
function Loader<T>({ query, children }: { query: { data?: T; error: unknown; isLoading: boolean; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;
  return <>{children(query.data)}</>;
}

// ---------------------------------------------------------------- sections

/** Fees come from Stripe's balance transactions; when any is missing the total is unavailable, never 0. */
function FeeAndNetStats({ m }: { m: StripeMoney }) {
  const known = m.feesCents != null;
  return (
    <>
      <Stat label="Stripe fees" value={known ? money(m.feesCents, m.currency) : 'Unavailable'} hint={known ? 'From Stripe balance transactions' : 'Stripe did not report a fee in this currency for every payment'} />
      <Stat label="Net after refunds and fees" value={known ? money(m.netCents, m.currency) : 'Unavailable'} hint="Not profit: excludes taxes, disputes, payouts and all other costs" />
    </>
  );
}

function StripeBlock({ stripe }: { stripe: StripeSummary }) {
  if (!stripe.available) return <Unavailable reason={stripe.reason} />;
  if (!stripe.byCurrency.length) return <Body muted style={{ fontSize: 13 }}>No Stripe payments in this range{stripe.livemode ? '' : ' (test mode)'}.</Body>;
  return (
    <View style={{ gap: space(2) }}>
      {!stripe.livemode && <Badge label="Stripe test mode" tone="warning" />}
      {stripe.byCurrency.map((m) => (
        <Stats key={m.currency}>
          <Stat label={`Gross payments (${m.currency.toUpperCase()})`} value={money(m.grossCents, m.currency)} hint={`${m.successfulPayments} successful`} />
          <Stat label="Refunds" value={money(m.refundedCents, m.currency)} hint={`${m.refunds} refunds`} />
          <FeeAndNetStats m={m} />
          <Stat label="Failed payments" value={int(m.failedPayments)} />
        </Stats>
      ))}
      {stripe.truncated && <Body muted style={{ fontSize: 12 }}>Only the first 2,000 payments or refunds of the range were read; totals are partial.</Body>}
    </View>
  );
}

function OverviewTab({ range }: { range: AdminRange }) {
  const q = useQuery({ queryKey: ['admin', 'overview', range], queryFn: () => api.admin<AdminOverview>('overview', { range }) });
  return (
    <Loader query={q}>
      {(o) => (
        <>
          <Section title="Accounts" source="database">
            <Stats>
              <Stat label="Registered users" value={int(o.users.total)} hint={`${int(o.users.newInRange)} new in range`} />
              <Stat label="Free" value={int(o.accounts.free)} />
              <Stat label="Active trials" value={int(o.accounts.trial)} />
              <Stat label="Paying subscribers" value={int(o.accounts.paid)} hint={`${int(o.accounts.paidCancelling)} cancelling at period end`} />
              <Stat label="Owner accounts" value={int(o.accounts.owner)} />
            </Stats>
            <SectionLabel>Signups</SectionLabel>
            <Bars points={o.users.signups} />
          </Section>
          <Section title="Conversion" source="analytics" note="Trials started and conversions in the same range; cohorts overlap ranges, so the rate is indicative. A trial is never counted as paid.">
            <Stats>
              <Stat label="Trials started" value={int(o.conversion.trialsStarted)} />
              <Stat label="Trials converted to paid" value={int(o.conversion.trialConversions)} hint={percent(o.conversion.trialConversionRate)} />
              <Stat label="Paid without a trial" value={int(o.conversion.paidStartsWithoutTrial)} />
              <Stat label="Cancellations" value={int(o.conversion.cancellations)} />
              <Stat label="Paid subscriptions ended" value={int(o.conversion.paidExpirations)} />
              <Stat label="Trials ended unpaid" value={int(o.conversion.trialExpirations)} />
            </Stats>
          </Section>
          <Section title="Recurring revenue" source="estimate" note={o.recurringRevenue.basis}>
            <Stats>
              <Stat label="MRR (estimate)" value={money(o.recurringRevenue.mrrCents, 'EUR')} hint={`${o.recurringRevenue.payingSubscriptions} renewing subscriptions`} />
              <Stat label="ARR (estimate)" value={money(o.recurringRevenue.arrCents, 'EUR')} />
              <Stat label="Test subscriptions excluded" value={int(o.recurringRevenue.excludedTestSubscriptions)} />
            </Stats>
          </Section>
          <Section title="Payments" source="stripe">
            <StripeBlock stripe={o.stripe} />
          </Section>
          <Section title="Costs" source="estimate" note={o.aiCost.trackedSince ? `AI usage recorded since ${date(o.aiCost.trackedSince)}; earlier usage was not measured.` : 'No AI usage recorded yet.'}>
            <Stats>
              <Stat label="AI (estimate)" value={dollars(o.aiCost.estimatedUsd)} hint={`${int(o.aiCost.calls)} calls${o.aiCost.unpricedCalls ? `, ${o.aiCost.unpricedCalls} unpriced` : ''}`} />
              <Stat label="Transcription (estimate)" value={dollars(o.aiCost.transcription.estimatedUsd)} hint={`${int(o.aiCost.transcription.minutes)} lecture minutes`} />
            </Stats>
            <Unavailable reason={o.contribution.reason} />
          </Section>
        </>
      )}
    </Loader>
  );
}

const CATEGORY_TONE: Record<AdminCategory, 'neutral' | 'primary' | 'success' | 'warning'> = { free: 'neutral', trial: 'warning', paid: 'success', owner: 'primary' };
const ALL = '' as const;

type SubscriptionStatusFilter = '' | 'none' | 'trialing' | 'active' | 'cancelled' | 'expired';
const PLAN_OPTIONS: { value: Tier | typeof ALL; label: string }[] = [
  { value: ALL, label: 'Any plan' },
  ...(['free', 'trial', 'basic', 'student', 'pro'] as const).map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) })),
];
const STATUS_OPTIONS: { value: SubscriptionStatusFilter; label: string }[] = [
  { value: '', label: 'Any status' },
  { value: 'none', label: 'No subscription' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'active', label: 'Active' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];
const SORT_OPTIONS: { value: AdminCustomerSort; label: string }[] = [
  { value: 'signup_desc', label: 'Newest' },
  { value: 'signup_asc', label: 'Oldest' },
  { value: 'email_asc', label: 'Email A–Z' },
  { value: 'last_active_desc', label: 'Recently active' },
  { value: 'ai_cost_desc', label: 'AI cost (all time)' },
  { value: 'ai_cost_30d_desc', label: 'AI cost (30 days)' },
  { value: 'ai_calls_desc', label: 'AI calls' },
];

/** AI cost for a directory row: never shows 0 when nothing could have been recorded. */
function aiCell(ai: AdminCustomerAI) {
  if (ai.coverage === 'not_tracked') return 'not tracked';
  const text = `${dollars(ai.estimatedUsd)} / ${dollars(ai.last30dUsd)}${ai.coverage === 'partial' ? ' *' : ''}`;
  return ai.unusual ? (
    <View key="ai" style={{ gap: space(1) }}>
      <Text style={{ fontSize: 13, color: colors.text }}>{text}</Text>
      <Badge label="Unusual" tone="warning" />
    </View>
  ) : (
    text
  );
}

function CustomersTab({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<AdminCategory | typeof ALL>(ALL);
  const [plan, setPlan] = useState<Tier | typeof ALL>(ALL);
  const [status, setStatus] = useState<SubscriptionStatusFilter>('');
  const [activity, setActivity] = useState<'' | 'active_7d' | 'active_30d' | 'inactive_30d'>('');
  const [sort, setSort] = useState<AdminCustomerSort>('signup_desc');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'customers', q, category, plan, status, activity, sort, page],
    queryFn: () => api.admin<AdminCustomersPage>('customers', { q, category, plan, status, activity, sort, page, limit: 25 }),
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  if (selected) return <CustomerDetail id={selected} onBack={() => onSelect(null)} />;
  return (
    <>
      <Card style={{ gap: space(3) }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => {
            setQ(search.trim());
            setPage(1);
          }}
          placeholder="Search by email, then press Enter"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          maxLength={100}
          accessibilityLabel="Search customers by email"
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: space(3), fontSize: 15, color: colors.text }}
        />
        <Chips
          options={[{ value: ALL as AdminCategory | typeof ALL, label: 'All accounts' }, ...(['free', 'trial', 'paid', 'owner'] as const).map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1) }))]}
          value={category}
          onChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        />
        <Chips
          options={[
            { value: '' as const, label: 'Any activity' },
            { value: 'active_7d' as const, label: 'Active 7 days' },
            { value: 'active_30d' as const, label: 'Active 30 days' },
            { value: 'inactive_30d' as const, label: 'Inactive 30+ days' },
          ]}
          value={activity}
          onChange={(v) => {
            setActivity(v);
            setPage(1);
          }}
        />
        <SectionLabel>Current plan</SectionLabel>
        <Chips options={PLAN_OPTIONS} value={plan} onChange={reset(setPlan)} />
        <SectionLabel>Subscription status</SectionLabel>
        <Chips options={STATUS_OPTIONS} value={status} onChange={reset(setStatus)} />
        <SectionLabel>Sort by</SectionLabel>
        <Chips options={SORT_OPTIONS} value={sort} onChange={reset(setSort)} />
      </Card>
      <Loader query={list}>
        {(p) => (
          <Section
            title={`Customers · ${int(p.total)}`}
            source="database"
            note="Usage counts are all-time. AI is an estimate from recorded calls (all time / last 30 days); * = account older than AI recording, so earlier usage is unknown. Tap a row for details."
          >
            <Table
              columns={['Email', 'Plan', 'Status', 'Signed up', 'Last active', 'Usage', 'AI est. all / 30d']}
              rows={p.items.map((c: AdminCustomer) => [
                `${c.email}${c.emailVerified ? '' : ' (unverified)'}`,
                <Badge key="b" label={`${c.category} · ${c.entitlementTier}`} tone={CATEGORY_TONE[c.category]} />,
                c.subscriptionStatus ? `${c.subscriptionStatus}${c.willRenew === false ? ' · ends' : ''}` : '—',
                date(c.signupAt),
                date(c.lastActivityAt),
                `${c.usage.coursesCreated} courses · ${c.usage.exams} exams`,
                aiCell(c.ai),
              ])}
              onRowPress={(i) => onSelect(p.items[i]!.id)}
            />
            <View style={{ flexDirection: 'row', gap: space(2), justifyContent: 'space-between', alignItems: 'center' }}>
              <Button variant="secondary" title="Previous" onPress={() => setPage((x) => Math.max(1, x - 1))} disabled={page <= 1} />
              <Body muted style={{ fontSize: 13 }}>{`Page ${p.page}`}</Body>
              <Button variant="secondary" title="Next" onPress={() => setPage((x) => x + 1)} disabled={!p.hasMore} />
            </View>
          </Section>
        )}
      </Loader>
    </>
  );
}

function CustomerDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => api.adminCustomer<AdminCustomerDetail>(id) });
  return (
    <>
      <Button variant="secondary" title="Back to customers" onPress={onBack} />
      <Loader query={q}>
        {(d) => (
          <>
            <Section title="Account" source="database">
              <KeyValue k="Email" v={`${d.customer.email}${d.customer.emailVerified ? ' · verified' : ' · not verified'}`} />
              <KeyValue k="Signed up" v={date(d.customer.signupAt)} />
              <KeyValue k="Category / entitlement" v={`${d.customer.category} · ${d.customer.entitlementTier}`} />
              <KeyValue k="Last activity" v={date(d.customer.lastActivityAt)} />
              <KeyValue k="Onboarding" v={d.customer.onboarding ?? '—'} />
              <KeyValue k="App language / time zone" v={`${d.customer.language ?? '—'} / ${d.customer.timeZone ?? '—'}`} />
              <KeyValue k="Courses (now / ever created)" v={`${d.customer.usage.coursesNow} / ${d.customer.usage.coursesCreated}`} />
              <KeyValue k="Exams · practice questions · study plans" v={`${d.customer.usage.exams} · ${d.customer.usage.practiceQuestions} · ${d.customer.usage.studyPlans}`} />
              <KeyValue k="Lecture uploads · minutes" v={`${d.customer.usage.lectureUploads} · ${d.customer.usage.lectureMinutes}`} />
            </Section>
            <Section title="Subscription" source="database">
              {d.subscription ? (
                <>
                  <KeyValue k="Provider · environment" v={`${d.subscription.provider} · ${d.subscription.environment}`} />
                  <KeyValue k="Plan · status" v={`${d.subscription.planId} · ${d.subscription.status}`} />
                  <KeyValue k="Trial ends" v={date(d.subscription.trialEndsAt)} />
                  <KeyValue k="Current period ends" v={date(d.subscription.currentPeriodEndsAt)} />
                  <KeyValue k="Renews" v={d.subscription.willRenew ? 'yes' : 'no'} />
                </>
              ) : (
                <Body muted>No subscription record.</Body>
              )}
              {d.stripe && (
                <View style={{ gap: space(2) }}>
                  {d.stripe.customerUrl && <Button variant="secondary" title={`Stripe customer ${d.stripe.customerId}`} onPress={() => openUrl(d.stripe!.customerUrl!)} />}
                  {d.stripe.subscriptionUrl && <Button variant="secondary" title={`Stripe subscription ${d.stripe.subscriptionId}`} onPress={() => openUrl(d.stripe!.subscriptionUrl!)} />}
                </View>
              )}
            </Section>
            <Section title="Plan history" source="analytics">
              <Table columns={['Event', 'When', 'Details']} rows={d.planHistory.map((e) => [e.name, date(e.createdAt), Object.entries(e.properties).map(([k, v]) => `${k}: ${String(v)}`).join(', ')])} />
            </Section>
            <Section title="Usage by month (last 12)" source="database">
              <Table columns={['Month', 'Kind', 'Total']} rows={d.usageByMonth.map((u) => [u.month, u.kind, int(u.total)])} />
            </Section>
            <CustomerAISection d={d} />
            <CustomerPaymentsSection payments={d.payments} />
            <Section title="Recent events" source="analytics">
              <Table columns={['Event', 'Source', 'When', 'Details']} rows={d.recentEvents.map((e) => [e.name, e.source, new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 16), eventDetails(e.properties)])} />
            </Section>
          </>
        )}
      </Loader>
    </>
  );
}

const COVERAGE_NOTE: Record<AdminCustomerAI['coverage'], string> = {
  full: 'This account was created after AI recording started, so these figures cover all of its AI usage.',
  partial: 'This account is older than AI recording: usage before that date was never measured and is unknown (not zero).',
  not_tracked: 'No AI calls have been recorded on this server yet, so AI usage is unavailable.',
};

function UsageWindowStat({ label, w }: { label: string; w: AdminUsageWindow }) {
  return (
    <Stat
      label={label}
      value={dollars(w.estimatedUsd)}
      hint={`${int(w.calls)} calls${w.failedCalls ? ` (${int(w.failedCalls)} failed)` : ''} · ${int(w.inputTokens)} in / ${int(w.outputTokens)} out tokens${w.unpricedCalls ? ` · ${int(w.unpricedCalls)} unpriced` : ''}`}
    />
  );
}

function CustomerAISection({ d }: { d: AdminCustomerDetail }) {
  const a = d.aiUsage;
  const note = `${COVERAGE_NOTE[a.coverage]} ${a.trackedSince ? `Recording started ${date(a.trackedSince)}.` : ''} Token counts are reported by the AI provider; costs are estimates${a.pricingVersions.length ? ` (price table ${a.pricingVersions.join(', ')})` : ''}, not invoices.`;
  return (
    <>
      <Section title="AI usage" source="estimate" note={note}>
        {a.coverage === 'not_tracked' ? (
          <Unavailable reason="No AI calls have been recorded on this server yet." />
        ) : (
          <>
            {d.customer.ai.unusual && <Badge label="Unusual consumption in the last 7 days" tone="warning" />}
            <Stats>
              <UsageWindowStat label="Last 7 days" w={a.last7d} />
              <UsageWindowStat label="Last 30 days" w={a.last30d} />
              <UsageWindowStat label={a.coverage === 'partial' ? 'Since recording started' : 'All time'} w={a.allTime} />
            </Stats>
            {a.allTime.calls === 0 ? (
              <Body muted style={{ fontSize: 13 }}>No AI calls recorded for this customer.</Body>
            ) : (
              <>
                <SectionLabel>Estimated cost per day (last 30 days)</SectionLabel>
                <Bars points={a.daily.map((x) => ({ bucket: x.day, count: x.estimatedUsd }))} format={(n) => dollars(n)} />
                <SectionLabel>By feature</SectionLabel>
                <Table columns={['Feature', 'Calls', 'Tokens in / out', 'Est. cost']} rows={d.aiByFeature.map((x) => [x.feature, int(x.calls), `${int(x.inputTokens)} / ${int(x.outputTokens)}`, dollars(x.estimatedUsd)])} />
                <SectionLabel>By model</SectionLabel>
                <Table
                  columns={['Model', 'Calls', 'Tokens in / out', 'Est. cost', 'Unpriced']}
                  rows={a.byModel.map((m) => [`${m.provider} · ${m.model}`, int(m.calls), `${int(m.inputTokens)} / ${int(m.outputTokens)}`, dollars(m.estimatedUsd), int(m.unpricedCalls)])}
                />
              </>
            )}
          </>
        )}
      </Section>
      <Section title="Lecture transcription" source="estimate" note={`Billed lecture minutes from the usage ledger × $${a.transcription.usdPerMinute}/min. An estimate, not the transcription provider's invoice.`}>
        <Stats>
          <Stat label="Minutes (all time)" value={int(a.transcription.minutes)} hint={`${int(a.transcription.minutesLast30d)} in the last 30 days`} />
          <Stat label="Transcription cost (estimate)" value={dollars(a.transcription.estimatedUsd)} />
        </Stats>
      </Section>
    </>
  );
}

function CustomerPaymentsSection({ payments }: { payments: AdminCustomerDetail['payments'] }) {
  return (
    <Section
      title="Payments"
      source="stripe"
      note="Read live from Stripe for this customer only. Gross = captured, successful payments; refunded = what Stripe reports refunded on those payments (each counted once, on its own payment); failed, pending and uncaptured payments are not money received. Gross and net are not profit."
    >
      {!payments.available ? (
        <Unavailable reason={payments.reason} />
      ) : (
        <>
          {!payments.livemode && <Badge label="Stripe test mode" tone="warning" />}
          {payments.byCurrency.length ? (
            payments.byCurrency.map((m) => (
              <Stats key={m.currency}>
                <Stat label={`Gross payments (${m.currency.toUpperCase()})`} value={money(m.grossCents, m.currency)} hint={`${m.successfulPayments} successful`} />
                <Stat label="Refunded" value={money(m.refundedCents, m.currency)} hint={`${m.refunds} refunded payments`} />
                <FeeAndNetStats m={m} />
                <Stat label="Failed payments" value={int(m.failedPayments)} />
              </Stats>
            ))
          ) : (
            <Body muted style={{ fontSize: 13 }}>No Stripe payments for this customer.</Body>
          )}
          <Table
            columns={['Date', 'Amount', 'Refunded', 'Status', '']}
            rows={payments.charges.map((c) => [
              date(c.created),
              money(c.amountCents, c.currency),
              c.refundedCents ? money(c.refundedCents, c.currency) : '—',
              `${c.failureCode ? `${c.status} (${c.failureCode})` : c.status}${c.disputed ? ' · disputed' : ''}`,
              <Button key="open" variant="secondary" title="Open in Stripe" onPress={() => openUrl(c.url)} />,
            ])}
          />
          {payments.truncated && <Body muted style={{ fontSize: 12 }}>Only the latest 100 payments were read; totals are partial.</Body>}
        </>
      )}
    </Section>
  );
}

function AITab({ range, onOpenCustomer }: { range: AdminRange; onOpenCustomer: (id: string) => void }) {
  const q = useQuery({ queryKey: ['admin', 'ai', range], queryFn: () => api.admin<AdminAIReport>('ai', { range }) });
  return (
    <Loader query={q}>
      {(a) => (
        <>
          <Section
            title="AI and transcription costs"
            source="estimate"
            note={`Estimates from provider-reported tokens × price table ${a.prices.version} (${Object.entries(a.prices.models).map(([m, p]) => `${m}: $${p.inputPerMTok}/$${p.outputPerMTok} per M tokens`).join('; ') || 'no models priced'}); transcription $${a.prices.transcriptionUsdPerMinute}/min. Not invoices. ${a.totals.trackedSince ? `Recorded since ${date(a.totals.trackedSince)}.` : 'Nothing recorded yet.'}`}
          >
            <Stats>
              <Stat label="AI calls" value={int(a.totals.calls)} hint={`${int(a.totals.failedCalls)} failed`} />
              <Stat label="Tokens in / out" value={`${int(a.totals.inputTokens)} / ${int(a.totals.outputTokens)}`} />
              <Stat label="AI cost (estimate)" value={dollars(a.totals.estimatedUsd)} hint={a.totals.unpricedCalls ? `${a.totals.unpricedCalls} unpriced calls not included` : undefined} />
              <Stat label="Transcription (estimate)" value={dollars(a.totals.transcription.estimatedUsd)} hint={`${int(a.totals.transcription.minutes)} minutes`} />
              <Stat label="Per active user" value={dollars(a.perActiveUserUsd)} hint={`${int(a.activeUsers)} active users`} />
              <Stat label="Per paying subscriber" value={dollars(a.perPayingSubscriberUsd)} hint={`${int(a.payingSubscribers)} paying (all users' costs)`} />
            </Stats>
            <Bars points={a.series.map((s) => ({ bucket: s.bucket, count: s.estimatedUsd }))} format={(n) => dollars(n)} />
          </Section>
          <Section title="By feature">
            <Table
              columns={['Feature', 'Calls', 'Failed', 'Tokens in / out', 'Est. cost', 'p50 / p95 ms']}
              rows={a.byFeature.map((f) => [f.feature, int(f.calls), int(f.failedCalls), `${int(f.inputTokens)} / ${int(f.outputTokens)}`, dollars(f.estimatedUsd), `${int(f.p50LatencyMs)} / ${int(f.p95LatencyMs)}`])}
            />
          </Section>
          <Section title="By provider and model">
            <Table columns={['Model', 'Calls', 'Tokens in / out', 'Est. cost', 'Unpriced']} rows={a.byModel.map((m) => [`${m.provider} · ${m.model}`, int(m.calls), `${int(m.inputTokens)} / ${int(m.outputTokens)}`, dollars(m.estimatedUsd), int(m.unpricedCalls)])} />
          </Section>
          <Section title="Highest-cost customers">
            <Table
              columns={['Customer', 'Calls', 'Est. cost']}
              rows={a.topUsers.map((u) => [u.email ?? (u.userId ? 'deleted account' : 'not attributed'), int(u.calls), dollars(u.estimatedUsd)])}
              onRowPress={(i) => {
                const u = a.topUsers[i]!;
                if (u.userId && u.email) onOpenCustomer(u.userId);
              }}
            />
          </Section>
          <Section title="Unusual consumption" note="Last 7 days at least 3× the customer's weekly average of the 4 weeks before (and at least $0.25), or $1+ with no earlier usage.">
            <Table
              columns={['Customer', 'Last 7 days', 'Previous weekly average']}
              rows={a.anomalies.map((x) => [x.email ?? x.userId, dollars(x.last7dUsd), dollars(x.previousWeeklyAvgUsd)])}
              onRowPress={(i) => onOpenCustomer(a.anomalies[i]!.userId)}
            />
          </Section>
        </>
      )}
    </Loader>
  );
}

function BillingTab({ range }: { range: AdminRange }) {
  const q = useQuery({ queryKey: ['admin', 'billing', range], queryFn: () => api.admin<AdminBillingReport>('billing', { range }) });
  return (
    <Loader query={q}>
      {(b) => (
        <>
          <Section title="Subscriptions" source="database" note={b.database.note}>
            <Stats>
              {Object.entries(b.database.byStatus).map(([s, n]) => (
                <Stat key={s} label={s} value={int(n)} />
              ))}
              <Stat label="Trials ending in 7 days" value={int(b.database.trialsEndingNext7d)} />
              <Stat label="Cancelling at period end" value={int(b.database.cancellingAtPeriodEnd)} />
            </Stats>
            <Table columns={['Plan', 'Subscriptions (not expired)']} rows={b.database.byPlan.map((p) => [p.planId, int(p.count)])} />
          </Section>
          <Section title="Payments" source="stripe">
            <StripeBlock stripe={b.stripe} />
          </Section>
          <Section title="Recent Stripe payments" source="stripe">
            {Array.isArray(b.charges) ? (
              <Table
                columns={['Payment', 'Date', 'Amount', 'Refunded', 'Status']}
                rows={b.charges.map((c) => [c.id, date(c.created), money(c.amountCents, c.currency), money(c.refundedCents, c.currency), `${c.status}${c.failureCode ? ` (${c.failureCode})` : ''}`])}
                onRowPress={(i) => openUrl((b.charges as Exclude<AdminBillingReport['charges'], { available: false }>)[i]!.url)}
              />
            ) : (
              <Unavailable reason={b.charges.reason} />
            )}
          </Section>
          <Section title="Latest subscription changes" source="database">
            <Table
              columns={['Customer', 'Plan', 'Status', 'Trial ends', 'Period ends', 'Renews']}
              rows={b.database.subscriptions.map((s) => [`${s.email} · ${s.provider}`, s.planId, `${s.status}${s.environment === 'production' ? '' : ` (${s.environment})`}`, date(s.trialEndsAt), date(s.currentPeriodEndsAt), s.willRenew ? 'yes' : 'no'])}
              onRowPress={(i) => {
                const url = b.database.subscriptions[i]!.stripeUrl;
                if (url) openUrl(url);
              }}
            />
          </Section>
        </>
      )}
    </Loader>
  );
}

function AnalyticsTab({ range }: { range: AdminRange }) {
  const q = useQuery({ queryKey: ['admin', 'analytics', range], queryFn: () => api.admin<AdminAnalyticsReport>('analytics', { range }) });
  const [event, setEvent] = useState('signup_completed');
  return (
    <Loader query={q}>
      {(a) => {
        const base = a.funnel[0]?.users ?? 0;
        return (
          <>
            <Section title="Funnel · accounts that signed up in this range" note="Each step counts accounts from the cohort that reached it at any time.">
              {a.funnel.map((s) => (
                <View key={s.key} style={{ gap: space(1) }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2), flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 14, color: colors.text }}>{s.label}</Text>
                    <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
                      <SourceBadge source={s.source} />
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{s.users == null ? 'not recorded' : `${int(s.users)}${base ? ` · ${percent(s.users / base)}` : ''}`}</Text>
                    </View>
                  </View>
                  {s.users != null && base > 0 && (
                    <View style={{ height: 8, backgroundColor: colors.bg, borderRadius: 4 }}>
                      <View style={{ width: `${Math.max(1, (s.users / base) * 100)}%`, height: 8, backgroundColor: colors.primary, borderRadius: 4 }} />
                    </View>
                  )}
                  {s.note && <Text style={{ fontSize: 12, color: colors.muted }}>{s.note}</Text>}
                </View>
              ))}
            </Section>
            <Section title="Trends" source="analytics">
              <Chips options={Object.keys(a.series).map((e) => ({ value: e, label: e.replace(/_/g, ' ') }))} value={event} onChange={setEvent} />
              <Bars points={a.series[event] ?? []} />
            </Section>
            <Section title="Missing or recent instrumentation">
              {a.missing.map((m) => (
                <View key={m.event} style={{ gap: space(1), paddingVertical: space(1) }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{`${m.event}${m.firstSeen ? ` · since ${date(m.firstSeen)}` : ' · not recorded'}`}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{m.note}</Text>
                </View>
              ))}
            </Section>
          </>
        );
      }}
    </Loader>
  );
}

function HealthTab() {
  const q = useQuery({ queryKey: ['admin', 'health'], queryFn: () => api.admin<AdminHealth>('health'), refetchInterval: 60_000 });
  return (
    <Loader query={q}>
      {(h) => (
        <>
          <Section title="Service" source="database">
            <KeyValue k="API" v={`up ${Math.round(h.api.uptimeSeconds / 60)} min · ${h.api.node}`} />
            <KeyValue k="Database" v={h.database.ok ? 'reachable' : 'unreachable'} />
            <KeyValue k="Migrations applied / expected" v={`${int(h.database.migrationsApplied)} / ${int(h.database.migrationsExpected)}${h.database.upToDate === false ? ' — behind' : ''}`} />
            <KeyValue k="Latest migration in this build" v={h.database.latestExpected ?? '—'} />
            {Object.entries(h.features).map(([k, v]) => (
              <KeyValue key={k} k={k} v={<Badge label={v} tone={v === 'enabled' ? 'success' : 'neutral'} />} />
            ))}
          </Section>
          <Section title="Background processing" source="database">
            <KeyValue k="Courses processing (stuck > 30 min)" v={`${int(h.jobs.documentsProcessing)} (${int(h.jobs.documentsStuck)})`} />
            <KeyValue k="Courses failed (7 days)" v={int(h.jobs.documentsFailed7d)} />
            <KeyValue k="Materials processing / failed (7 days)" v={`${int(h.jobs.materialsProcessing)} / ${int(h.jobs.materialsFailed7d)}`} />
          </Section>
          <Section title="AI provider · last 24 hours" source="database">
            <KeyValue k="Calls · failed" v={`${int(h.ai.calls24h)} · ${int(h.ai.failed24h)} (${percent(h.ai.errorRate24h)})`} />
            <KeyValue k="Latency p50 / p95" v={`${int(h.ai.p50LatencyMs)} / ${int(h.ai.p95LatencyMs)} ms`} />
            {Object.entries(h.ai.errorCodes).map(([k, v]) => (
              <KeyValue key={k} k={`Error: ${k}`} v={int(v)} />
            ))}
          </Section>
          <Section title="Stripe webhooks · last 7 days" source="database">
            <KeyValue k="Received" v={int(h.stripeWebhooks.received7d)} />
            <KeyValue k="Not processed after 10 min" v={int(h.stripeWebhooks.unprocessed)} />
            <KeyValue k="Last received" v={h.stripeWebhooks.lastReceivedAt ? new Date(h.stripeWebhooks.lastReceivedAt).toISOString().replace('T', ' ').slice(0, 16) : '—'} />
          </Section>
          <Section title="Email · last 7 days" source="database">
            {Object.keys(h.email.reminders7d).length ? (
              Object.entries(h.email.reminders7d).map(([k, v]) => <KeyValue key={k} k={`Study reminders ${k}`} v={int(v)} />)
            ) : (
              <Body muted style={{ fontSize: 13 }}>No study reminder emails.</Body>
            )}
            <Unavailable reason={h.email.otherEmails.reason} />
          </Section>
        </>
      )}
    </Loader>
  );
}

// ---------------------------------------------------------------- screen

export default function AdminScreen() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<AdminRange>('30d');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const openCustomer = (id: string) => {
    setCustomerId(id);
    setTab('customers');
  };
  const access = useQuery({ queryKey: ['admin-access'], queryFn: api.adminAccess, retry: false });
  const denied = access.error instanceof ApiError && (access.error.status === 403 || access.error.status === 401);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Admin' }} />
      {access.isLoading ? (
        <Loading />
      ) : denied ? (
        <Card>
          <Title>Not available</Title>
          <Body muted>This page is only for Exama owners.</Body>
        </Card>
      ) : access.error ? (
        <ErrorState error={access.error} onRetry={() => void access.refetch()} />
      ) : (
        <>
          <Title>Admin dashboard</Title>
          <Body muted style={{ fontSize: 13 }}>Read-only. Database = Exama’s records · Stripe = live from Stripe · Analytics = product events · Estimate = calculated, not charged.</Body>
          <Chips options={TABS} value={tab} onChange={setTab} />
          {tab !== 'customers' && tab !== 'health' && <Chips options={RANGES} value={range} onChange={setRange} />}
          {tab === 'overview' && <OverviewTab range={range} />}
          {tab === 'customers' && <CustomersTab selected={customerId} onSelect={setCustomerId} />}
          {tab === 'ai' && <AITab range={range} onOpenCustomer={openCustomer} />}
          {tab === 'billing' && <BillingTab range={range} />}
          {tab === 'analytics' && <AnalyticsTab range={range} />}
          {tab === 'health' && <HealthTab />}
        </>
      )}
    </Screen>
  );
}
