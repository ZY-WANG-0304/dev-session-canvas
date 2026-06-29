import { useEffect, useState } from 'react';

import type { MarketplaceAdminStatsResponse, MarketplaceReportStatus, MarketplaceTemplateReportSummary } from '@dev-session-canvas/marketplace-shared';

import {
  loadCurrentMarketplaceUser,
  loadMarketplaceAdminReports,
  loadMarketplaceAdminStats,
  resolveMarketplaceAdminReport,
  setMarketplaceAdminTemplateStatus,
  setMarketplaceAdminUserBan,
  type MarketplaceCurrentUser
} from '../lib/api';
import { buildGithubSignInHref, buildSignOutFormAction, buildTemplateDetailHref, getMarketplaceAdminHref, getMarketplaceHomeHref } from '../lib/routing';

interface AdminState {
  user?: MarketplaceCurrentUser;
  reports: MarketplaceTemplateReportSummary[];
  stats?: MarketplaceAdminStatsResponse;
  status: MarketplaceReportStatus;
  loading: boolean;
  actionId?: string;
  message?: string;
  errorMessage?: string;
}

const reportStatusOptions: MarketplaceReportStatus[] = ['open', 'resolved', 'rejected'];

export function TemplateAdminView(): JSX.Element {
  const [state, setState] = useState<AdminState>({
    reports: [],
    status: 'open',
    loading: true
  });

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setState((current) => ({ ...current, loading: true, errorMessage: undefined, message: undefined }));
      try {
        const currentUser = await loadCurrentMarketplaceUser();
        if (!currentUser.user) {
          if (!cancelled) {
            setState({ reports: [], status: 'open', loading: false });
          }
          return;
        }
        const [reports, stats] = await Promise.all([loadMarketplaceAdminReports(state.status), loadMarketplaceAdminStats()]);
        if (!cancelled) {
          setState((current) => ({
            ...current,
            user: currentUser.user,
            reports: reports.items,
            stats,
            loading: false
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            reports: [],
            loading: false,
            errorMessage: error instanceof Error ? error.message : 'Unable to load marketplace admin queue.'
          }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [state.status]);

  async function reload(status = state.status, message?: string): Promise<void> {
    try {
      const [reports, stats] = await Promise.all([loadMarketplaceAdminReports(status), loadMarketplaceAdminStats()]);
      setState((current) => ({
        ...current,
        reports: reports.items,
        stats,
        loading: false,
        actionId: undefined,
        message,
        errorMessage: undefined
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        actionId: undefined,
        errorMessage: error instanceof Error ? error.message : 'Unable to refresh marketplace admin queue.'
      }));
    }
  }

  async function runAdminAction(actionId: string, action: () => Promise<string>): Promise<void> {
    setState((current) => ({ ...current, actionId, message: undefined, errorMessage: undefined }));
    try {
      const message = await action();
      await reload(state.status, message);
    } catch (error) {
      setState((current) => ({
        ...current,
        actionId: undefined,
        errorMessage: error instanceof Error ? error.message : 'Marketplace admin action failed.'
      }));
    }
  }

  function updateStatus(status: MarketplaceReportStatus): void {
    setState((current) => ({ ...current, status, loading: true, message: undefined, errorMessage: undefined }));
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 text-sm">
        <a className="font-semibold text-canvas-moss hover:underline" href={getMarketplaceHomeHref()}>
          Back to templates
        </a>
      </div>

      <section className="border border-canvas-line bg-canvas-paper p-8 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-canvas-moss">Governance</p>
            <h1 className="mt-2 text-3xl font-semibold text-canvas-ink">Marketplace admin</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-canvas-muted">
              Review reports, delist or restore templates, and ban users. The Worker still enforces every permission and writes admin audit logs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {reportStatusOptions.map((status) => (
              <button
                key={status}
                className={`h-10 border px-4 text-sm font-semibold capitalize ${
                  state.status === status ? 'border-canvas-moss bg-canvas-moss text-canvas-accentText' : 'border-canvas-line bg-canvas-mist text-canvas-ink hover:border-canvas-moss'
                }`}
                type="button"
                onClick={() => updateStatus(status)}
                aria-pressed={state.status === status}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {state.loading ? (
          <div className="mt-8 border border-canvas-line bg-canvas-mist p-5 text-sm text-canvas-muted">Loading admin queue...</div>
        ) : state.errorMessage && !state.user ? (
          <AdminErrorPanel message={state.errorMessage} />
        ) : !state.user ? (
          <div className="mt-8 border border-canvas-line bg-canvas-mist p-6">
            <h2 className="text-lg font-semibold text-canvas-ink">GitHub sign-in required</h2>
            <p className="mt-2 text-sm leading-6 text-canvas-muted">Sign in with an administrator GitHub account to view the governance queue.</p>
            <a
              className="mt-5 inline-flex h-11 items-center bg-canvas-accent px-5 text-sm font-semibold text-canvas-accentText hover:brightness-110"
              href={buildGithubSignInHref(getMarketplaceAdminHref())}
            >
              Sign in with GitHub
            </a>
          </div>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border border-canvas-line bg-canvas-mist px-4 py-3 text-sm text-canvas-muted">
              <span>
                Signed in as <span className="font-semibold text-canvas-ink">{state.user.githubLogin}</span>
              </span>
              <form action={buildSignOutFormAction(getMarketplaceAdminHref())} method="post">
                <button className="border border-canvas-line bg-canvas-paper px-3 py-1 font-semibold text-canvas-ink hover:border-canvas-moss" type="submit">
                  Sign out
                </button>
              </form>
              <span>{state.reports.length} reports</span>
            </div>

            {state.errorMessage ? <AdminErrorPanel message={state.errorMessage} /> : null}
            {state.message ? <div className="mt-5 border border-canvas-line bg-canvas-mist p-4 text-sm text-canvas-ink">{state.message}</div> : null}

            {state.stats ? <AdminStatsPanel stats={state.stats} /> : null}

            {state.reports.length > 0 ? (
              <ol className="mt-8 space-y-5">
                {state.reports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    actionId={state.actionId}
                    onResolveAndDelist={() =>
                      runAdminAction(`resolve:${report.id}`, async () => {
                        await resolveMarketplaceAdminReport(report.id, {
                          status: 'resolved',
                          resolution: 'Resolved by marketplace admin.',
                          delistTemplate: true
                        });
                        return `Resolved ${report.id} and delisted ${report.template.slug}.`;
                      })
                    }
                    onReject={() =>
                      runAdminAction(`reject:${report.id}`, async () => {
                        await resolveMarketplaceAdminReport(report.id, {
                          status: 'rejected',
                          resolution: 'Rejected by marketplace admin.'
                        });
                        return `Rejected ${report.id}.`;
                      })
                    }
                    onRestoreTemplate={() =>
                      runAdminAction(`restore:${report.template.id}`, async () => {
                        await setMarketplaceAdminTemplateStatus(report.template.id, { status: 'published' });
                        return `Restored ${report.template.slug}.`;
                      })
                    }
                    onDelistTemplate={() =>
                      runAdminAction(`delist:${report.template.id}`, async () => {
                        await setMarketplaceAdminTemplateStatus(report.template.id, { status: 'delisted' });
                        return `Delisted ${report.template.slug}.`;
                      })
                    }
                    onBanPublisher={() =>
                      runAdminAction(`ban:${report.template.publisher.id}`, async () => {
                        await setMarketplaceAdminUserBan(report.template.publisher.id, { banned: true });
                        return `Banned ${report.template.publisher.githubLogin}.`;
                      })
                    }
                  />
                ))}
              </ol>
            ) : (
              <div className="mt-8 border border-dashed border-canvas-line bg-canvas-mist p-10 text-center text-sm text-canvas-muted">
                No {state.status} reports in the governance queue.
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function AdminStatsPanel({ stats }: { stats: MarketplaceAdminStatsResponse }): JSX.Element {
  const reportTotal = Math.max(1, stats.totals.reportCount);
  const openShare = Math.round((stats.totals.openReportCount / reportTotal) * 100);
  return (
    <section className="mt-8 space-y-5" aria-labelledby="admin-stats-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-canvas-moss">Marketplace health</p>
        <h2 id="admin-stats-heading" className="mt-1 text-2xl font-semibold text-canvas-ink">
          Global stats
        </h2>
      </div>
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Published templates" value={formatNumber(stats.totals.publishedTemplateCount)} detail={`${formatNumber(stats.totals.delistedTemplateCount)} delisted`} />
        <MetricCard label="Downloads" value={formatNumber(stats.totals.downloadCount)} detail={`${formatNumber(stats.totals.likeCount)} likes`} />
        <MetricCard label="Reports" value={formatNumber(stats.totals.reportCount)} detail={`${formatNumber(stats.totals.openReportCount)} open · ${openShare}%`} />
        <MetricCard label="Users" value={formatNumber(stats.totals.userCount)} detail={`${formatNumber(stats.totals.bannedUserCount)} banned · ${formatNumber(stats.totals.publisherCount)} publishers`} />
      </dl>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="border border-canvas-line bg-canvas-mist p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-lg font-semibold text-canvas-ink">Top templates</h3>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-canvas-muted">By downloads</p>
          </div>
          {stats.topTemplates.length > 0 ? (
            <ol className="mt-4 divide-y divide-canvas-line">
              {stats.topTemplates.map((item) => (
                <li key={item.template.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <a className="font-semibold text-canvas-ink hover:text-canvas-moss hover:underline" href={buildTemplateDetailHref(item.template.slug)}>
                    {item.template.name}
                  </a>
                  <span className="text-canvas-muted">
                    {formatNumber(item.downloadCount)} downloads · {formatNumber(item.likeCount)} likes · {formatNumber(item.publishCount)} publishes
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-canvas-muted">No published templates yet.</p>
          )}
        </div>
        <div className="border border-canvas-line bg-canvas-mist p-5">
          <h3 className="text-lg font-semibold text-canvas-ink">Recent daily activity</h3>
          {stats.daily.length > 0 ? (
            <dl className="mt-4 space-y-3">
              {stats.daily.slice(-5).map((point) => (
                <div key={point.day} className="grid grid-cols-[6.5rem_1fr] gap-3 text-sm">
                  <dt className="font-semibold text-canvas-ink">{point.day}</dt>
                  <dd className="text-canvas-muted">
                    {formatNumber(point.downloadCount)} downloads · {formatNumber(point.likeCount)} likes · {formatNumber(point.publishCount)} publishes
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 text-sm text-canvas-muted">No daily stats have been recorded yet.</p>
          )}
        </div>
      </div>
      <div className="border border-canvas-line bg-canvas-mist p-4 text-sm text-canvas-muted">
        {formatNumber(stats.totals.adminActionCount)} admin audit log entries recorded. Stats source: {stats.storageMode}.
      </div>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="border border-canvas-line bg-canvas-paper p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-canvas-muted">{label}</dt>
      <dd className="mt-2 text-3xl font-semibold text-canvas-ink">{value}</dd>
      <p className="mt-1 text-sm text-canvas-muted">{detail}</p>
    </div>
  );
}

function ReportCard({
  report,
  actionId,
  onResolveAndDelist,
  onReject,
  onRestoreTemplate,
  onDelistTemplate,
  onBanPublisher
}: {
  report: MarketplaceTemplateReportSummary;
  actionId?: string;
  onResolveAndDelist: () => void;
  onReject: () => void;
  onRestoreTemplate: () => void;
  onDelistTemplate: () => void;
  onBanPublisher: () => void;
}): JSX.Element {
  const disabled = Boolean(actionId);
  return (
    <li className="border border-canvas-line bg-canvas-paper">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="border border-canvas-line bg-canvas-mist px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-canvas-muted">
              {report.status}
            </span>
            <span className="border border-canvas-line bg-canvas-mist px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-canvas-muted">
              {report.reason}
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-canvas-ink">
            <a className="hover:text-canvas-moss hover:underline" href={buildTemplateDetailHref(report.template.slug)}>
              {report.template.name}
            </a>
          </h2>
          <p className="mt-2 text-sm leading-6 text-canvas-muted">
            Reported by <span className="font-semibold text-canvas-ink">{report.reporter.githubLogin}</span> against publisher{' '}
            <span className="font-semibold text-canvas-ink">{report.template.publisher.githubLogin}</span>.
          </p>
          {report.resolution ? <p className="mt-3 border-l-2 border-canvas-moss pl-3 text-sm leading-6 text-canvas-muted">{report.resolution}</p> : null}
          <dl className="mt-4 grid gap-3 text-sm text-canvas-muted sm:grid-cols-3">
            <SmallMeta label="Template status" value={report.template.status} />
            <SmallMeta label="Created" value={formatDate(report.createdAt)} />
            <SmallMeta label="Resolved" value={report.resolvedAt ? formatDate(report.resolvedAt) : 'Not resolved'} />
          </dl>
        </div>
        <div className="space-y-2">
          {report.status === 'open' ? (
            <>
              <AdminButton disabled={disabled} busy={actionId === `resolve:${report.id}`} onClick={onResolveAndDelist}>
                Resolve + delist
              </AdminButton>
              <AdminButton disabled={disabled} busy={actionId === `reject:${report.id}`} onClick={onReject} variant="secondary">
                Reject report
              </AdminButton>
            </>
          ) : null}
          {report.template.status === 'published' ? (
            <AdminButton disabled={disabled} busy={actionId === `delist:${report.template.id}`} onClick={onDelistTemplate} variant="secondary">
              Delist template
            </AdminButton>
          ) : (
            <AdminButton disabled={disabled} busy={actionId === `restore:${report.template.id}`} onClick={onRestoreTemplate} variant="secondary">
              Restore template
            </AdminButton>
          )}
          <AdminButton disabled={disabled} busy={actionId === `ban:${report.template.publisher.id}`} onClick={onBanPublisher} variant="secondary">
            Ban publisher
          </AdminButton>
        </div>
      </div>
    </li>
  );
}

function AdminButton({
  children,
  disabled,
  busy,
  onClick,
  variant = 'primary'
}: {
  children: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}): JSX.Element {
  const className =
    variant === 'primary'
      ? 'inline-flex w-full justify-center bg-canvas-accent px-4 py-3 text-xs font-semibold text-canvas-accentText transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'
      : 'inline-flex w-full justify-center border border-canvas-line bg-canvas-mist px-4 py-3 text-xs font-semibold text-canvas-ink transition hover:border-canvas-moss hover:text-canvas-moss disabled:cursor-not-allowed disabled:opacity-60';
  return (
    <button className={className} type="button" disabled={disabled} onClick={onClick}>
      {busy ? 'Working...' : children}
    </button>
  );
}

function SmallMeta({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-canvas-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-canvas-ink">{value}</dd>
    </div>
  );
}

function AdminErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div className="mt-8 border border-canvas-errorLine bg-canvas-errorBg p-5 text-sm text-canvas-error" role="alert">
      {message}
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
