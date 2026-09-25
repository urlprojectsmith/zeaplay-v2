'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  StatusIndicator,
} from '@zea-play/ui';
import {
  CreditCard,
  ExternalLink,
  FileText,
  History,
  Plus,
  RefreshCw,
  Rocket,
  Save,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  billingKeys,
  cancelSubscription,
  changeSubscription,
  createCheckoutSession,
  createPlatformPlan,
  createPlatformPlanPrice,
  createPortalSession,
  getAgencyUsage,
  getSuperAgencyBillingEntitlements,
  getSuperAgencyPaymentMethod,
  getSuperAgencyUsage,
  getWorkspaceUsage,
  listSuperAgencyBillingHistory,
  listSuperAgencyCheckoutPlans,
  listSuperAgencyInvoices,
  listPlatformPlans,
  publishPlatformPlanVersion,
  refreshSuperAgencyInvoices,
  updateAgencyAllocation,
  updateWorkspaceAllocation,
  type BillingHistoryItem,
  type BillingInvoice,
  type BillingResourceSummary,
  type EffectiveEntitlements,
  type MasterPlan,
  type PaymentMethodSummary,
} from '../../services/billing';
import { useSessionStore } from '../../stores/session';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { CardSkeleton } from '../layout/loading-states';

export function PlatformPlansPage() {
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tierRank, setTierRank] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('1999');
  const [annualAmount, setAnnualAmount] = useState('19900');
  const plansQuery = useQuery({
    queryKey: billingKeys.platformPlans(1),
    queryFn: () => listPlatformPlans(1),
  });
  const createMutation = useMutation({
    mutationFn: () =>
      createPlatformPlan({
        key,
        displayName,
        ...(tierRank.trim() ? { tierRank: Number(tierRank) } : {}),
      }),
    onSuccess: async () => {
      setKey('');
      setDisplayName('');
      await queryClient.invalidateQueries({ queryKey: ['platform-billing', 'plans'] });
      toast.success('Plan draft created');
    },
  });
  const publishMutation = useMutation({
    mutationFn: ({ planId, versionId }: { planId: string; versionId: string }) =>
      publishPlatformPlanVersion(planId, versionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-billing', 'plans'] });
      toast.success('Plan version published');
    },
  });
  const priceMutation = useMutation({
    mutationFn: ({
      planId,
      versionId,
      interval,
      amountMinor,
    }: {
      planId: string;
      versionId: string;
      interval: 'MONTHLY' | 'ANNUAL';
      amountMinor: number;
    }) => createPlatformPlanPrice(planId, versionId, { interval, amountMinor }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-billing', 'plans'] });
      toast.success('Stripe price mapping saved');
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title="Master Plans"
        description="Platform-controlled billing catalog and Stripe price mappings"
        actions={<Badge variant="info">USD monthly / annual</Badge>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Create Draft Plan</CardTitle>
          <CardDescription>
            Catalog setup only. No checkout, card, invoice, or payment action.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Input
            aria-label="Plan key"
            placeholder="plan-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <Input
            aria-label="Display name"
            placeholder="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <Input
            aria-label="Tier rank"
            placeholder="Tier rank"
            value={tierRank}
            onChange={(event) => setTierRank(event.target.value)}
          />
          <Button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!key.trim() || !displayName.trim() || createMutation.isPending}
          >
            <Plus className="h-4 w-4" />
            Create
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Price Defaults</CardTitle>
          <CardDescription>
            Amounts are integer USD cents; Stripe sync stays server-side.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Input
            aria-label="Monthly amount minor"
            value={monthlyAmount}
            onChange={(event) => setMonthlyAmount(event.target.value)}
          />
          <Input
            aria-label="Annual amount minor"
            value={annualAmount}
            onChange={(event) => setAnnualAmount(event.target.value)}
          />
        </CardContent>
      </Card>
      {plansQuery.isLoading ? <CardSkeleton /> : null}
      {plansQuery.data?.items.length === 0 ? (
        <EmptyState
          title="No master plans"
          description="Create a draft plan to begin catalog setup."
        />
      ) : null}
      <div className="grid gap-3">
        {plansQuery.data?.items.map((plan) => {
          const draft = plan.versions.find((version) => version.status === 'DRAFT');
          return (
            <Card key={plan.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>{plan.displayName}</CardTitle>
                    <CardDescription>
                      {plan.key} | {plan.type}
                    </CardDescription>
                  </div>
                  <Badge variant={plan.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {plan.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  {plan.versions.map((version) => (
                    <Badge
                      key={version.id}
                      variant={version.status === 'PUBLISHED' ? 'success' : 'neutral'}
                    >
                      v{version.versionNumber} {version.status}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(plan.prices ?? []).map((price) => (
                    <Badge
                      key={price.id}
                      variant={price.status === 'ACTIVE' ? 'success' : 'neutral'}
                    >
                      {price.interval} {formatUsdMinor(price.amountMinor)}{' '}
                      {price.externalPriceId ? 'synced' : 'draft'}
                    </Badge>
                  ))}
                </div>
                {draft ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => publishMutation.mutate({ planId: plan.id, versionId: draft.id })}
                    disabled={publishMutation.isPending}
                  >
                    <Rocket className="h-4 w-4" />
                    Publish Draft
                  </Button>
                ) : (
                  <StatusIndicator tone="success" label="No editable draft" />
                )}
                {plan.versions
                  .filter((version) => version.status === 'PUBLISHED')
                  .map((version) => (
                    <div key={version.id} className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          priceMutation.mutate({
                            planId: plan.id,
                            versionId: version.id,
                            interval: 'MONTHLY',
                            amountMinor: Number(monthlyAmount),
                          })
                        }
                        disabled={priceMutation.isPending}
                      >
                        Monthly Price
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          priceMutation.mutate({
                            planId: plan.id,
                            versionId: version.id,
                            interval: 'ANNUAL',
                            amountMinor: Number(annualAmount),
                          })
                        }
                        disabled={priceMutation.isPending}
                      >
                        Annual Price
                      </Button>
                    </div>
                  ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageContainer>
  );
}

export function SuperAgencyBillingPage() {
  const queryClient = useQueryClient();
  const selectedSuperAgencyId = useSessionStore((state) => state.selectedSuperAgencyId);
  const selectedSuperAgency = useSessionStore((state) =>
    state.superAgencies.find((item) => item.id === state.selectedSuperAgencyId),
  );
  const billingQuery = useQuery({
    queryKey: billingKeys.superAgencyEntitlements(selectedSuperAgencyId),
    queryFn: () => getSuperAgencyBillingEntitlements(selectedSuperAgencyId as string),
    enabled: Boolean(selectedSuperAgencyId),
  });
  const checkoutPlansQuery = useQuery({
    queryKey: billingKeys.superAgencyCheckoutPlans(selectedSuperAgencyId),
    queryFn: () => listSuperAgencyCheckoutPlans(selectedSuperAgencyId as string),
    enabled: Boolean(selectedSuperAgencyId),
  });
  const usageQuery = useQuery({
    queryKey: billingKeys.superAgencyUsage(selectedSuperAgencyId),
    queryFn: () => getSuperAgencyUsage(selectedSuperAgencyId as string),
    enabled: Boolean(selectedSuperAgencyId),
  });
  const invoicesQuery = useQuery({
    queryKey: billingKeys.superAgencyInvoices(selectedSuperAgencyId, 1),
    queryFn: () => listSuperAgencyInvoices(selectedSuperAgencyId as string, 1),
    enabled: Boolean(selectedSuperAgencyId),
  });
  const paymentMethodQuery = useQuery({
    queryKey: billingKeys.superAgencyPaymentMethod(selectedSuperAgencyId),
    queryFn: () => getSuperAgencyPaymentMethod(selectedSuperAgencyId as string),
    enabled: Boolean(selectedSuperAgencyId),
  });
  const historyQuery = useQuery({
    queryKey: billingKeys.superAgencyHistory(selectedSuperAgencyId, 1),
    queryFn: () => listSuperAgencyBillingHistory(selectedSuperAgencyId as string, 1),
    enabled: Boolean(selectedSuperAgencyId),
  });
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'plan'
    | 'usage'
    | 'allocations'
    | 'payment'
    | 'invoices'
    | 'history'
    | 'subscription'
  >('overview');
  const [billingInterval, setBillingInterval] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const checkoutMutation = useMutation({
    mutationFn: (body: { planVersionId: string; interval: 'MONTHLY' | 'ANNUAL' }) =>
      createCheckoutSession(selectedSuperAgencyId as string, body),
    onSuccess: (session) => {
      if (session.url) window.location.assign(session.url);
    },
  });
  const portalMutation = useMutation({
    mutationFn: () => createPortalSession(selectedSuperAgencyId as string),
    onSuccess: (session) => window.location.assign(session.url),
  });
  const changeMutation = useMutation({
    mutationFn: (body: { planVersionId: string; interval: 'MONTHLY' | 'ANNUAL' }) =>
      changeSubscription(selectedSuperAgencyId as string, body),
    onSuccess: async () => {
      await billingQuery.refetch();
      toast.success('Plan change requested');
    },
  });
  const refreshInvoicesMutation = useMutation({
    mutationFn: () => refreshSuperAgencyInvoices(selectedSuperAgencyId as string),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: billingKeys.superAgencyInvoices(selectedSuperAgencyId, 1),
      });
      toast.success(`Invoices refreshed (${result.synced})`);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelSubscription(selectedSuperAgencyId as string),
    onSuccess: async () => {
      await billingQuery.refetch();
      toast.success('Cancellation scheduled');
    },
  });

  if (!selectedSuperAgencyId) {
    return (
      <PageContainer>
        <EmptyState
          title="Switch Super Agency"
          description="Select a Super Agency to view billing."
        />
      </PageContainer>
    );
  }

  if (billingQuery.isLoading) {
    return (
      <PageContainer>
        <CardSkeleton />
      </PageContainer>
    );
  }

  const data = billingQuery.data;

  return (
    <PageContainer>
      <PageHeader
        title="Billing"
        description="Plans, usage, invoices, safe payment summary, and Customer Portal recovery"
        actions={<BillingAccessBadge level={data?.access?.level} />}
      />
      {data?.access?.level === 'FULL_WITH_WARNING' ? (
        <StatusIndicator
          tone="warning"
          label="Billing attention required; account remains fully operational during grace."
        />
      ) : null}
      {data?.access?.level === 'READ_ONLY_RESTRICTED' ? (
        <StatusIndicator
          tone="danger"
          label="Read-only restricted mode; data is preserved and billing recovery remains available."
        />
      ) : null}
      <BillingTabBar activeTab={activeTab} onChange={setActiveTab} />
      {activeTab === 'overview' ? (
        <BillingOverview
          subscription={data?.subscription}
          invoices={invoicesQuery.data?.items}
          paymentMethod={paymentMethodQuery.data?.paymentMethod}
          onManage={() => portalMutation.mutate()}
          managing={portalMutation.isPending}
        />
      ) : null}
      {activeTab === 'plan' ? (
        <CurrentPlanPanel
          data={data}
          checkoutPlans={checkoutPlansQuery.data}
          interval={billingInterval}
          onIntervalChange={setBillingInterval}
          onCheckout={(planVersionId) =>
            checkoutMutation.mutate({ planVersionId, interval: billingInterval })
          }
          onChange={(planVersionId) =>
            changeMutation.mutate({ planVersionId, interval: billingInterval })
          }
          pending={checkoutMutation.isPending || changeMutation.isPending}
        />
      ) : null}
      {activeTab === 'usage' ? (
        <UsageGrid
          title="Usage"
          resources={usageQuery.data?.resources}
          emptyLabel="Usage data is not available."
        />
      ) : null}
      {activeTab === 'allocations' ? (
        <AllocationManagementGrid
          scope="SUPER_AGENCY"
          superAgencyId={selectedSuperAgencyId}
          parentResources={usageQuery.data?.resources}
          rows={
            selectedSuperAgency?.agencies.map((agency) => ({
              id: agency.id,
              name: agency.name,
              status: agency.status,
            })) ?? []
          }
        />
      ) : null}
      {activeTab === 'payment' ? (
        <PaymentMethodPanel
          summary={paymentMethodQuery.data?.paymentMethod}
          onManage={() => portalMutation.mutate()}
          pending={portalMutation.isPending}
        />
      ) : null}
      {activeTab === 'invoices' ? (
        <InvoicesPanel
          invoices={invoicesQuery.data?.items}
          loading={invoicesQuery.isLoading}
          onRefresh={() => refreshInvoicesMutation.mutate()}
          refreshing={refreshInvoicesMutation.isPending}
        />
      ) : null}
      {activeTab === 'history' ? (
        <BillingHistoryPanel items={historyQuery.data?.items} loading={historyQuery.isLoading} />
      ) : null}
      {activeTab === 'subscription' ? (
        <SubscriptionPanel
          subscription={data?.subscription}
          onManage={() => portalMutation.mutate()}
          onCancel={() => cancelMutation.mutate()}
          pending={portalMutation.isPending || cancelMutation.isPending}
        />
      ) : null}
    </PageContainer>
  );
}

type BillingTab =
  | 'overview'
  | 'plan'
  | 'usage'
  | 'allocations'
  | 'payment'
  | 'invoices'
  | 'history'
  | 'subscription';

function BillingTabBar({
  activeTab,
  onChange,
}: {
  activeTab: BillingTab;
  onChange: (tab: BillingTab) => void;
}) {
  const tabs: Array<{ id: BillingTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'plan', label: 'Current Plan' },
    { id: 'usage', label: 'Usage' },
    { id: 'allocations', label: 'Agency Allocations' },
    { id: 'payment', label: 'Payment Method' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'history', label: 'Billing History' },
    { id: 'subscription', label: 'Subscription' },
  ];
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Billing tabs">
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          type="button"
          variant={activeTab === tab.id ? 'primary' : 'secondary'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}

function BillingOverview({
  subscription,
  invoices,
  paymentMethod,
  onManage,
  managing,
}: {
  subscription: EffectiveEntitlements['subscription'] | undefined | null;
  invoices?: BillingInvoice[];
  paymentMethod?: PaymentMethodSummary | null;
  onManage: () => void;
  managing: boolean;
}) {
  const amountDue = invoices?.find((invoice) => Number(invoice.amountRemainingMinor) > 0);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>{subscription?.status ?? 'No active subscription'}</CardDescription>
        </CardHeader>
        <CardContent>{subscription?.masterPlan.displayName ?? 'Choose a public plan'}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
          <CardDescription>Managed in Stripe Customer Portal</CardDescription>
        </CardHeader>
        <CardContent>
          {paymentMethod
            ? `${paymentMethod.displayBrand} ending ${paymentMethod.last4 ?? '----'}`
            : 'No default method'}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Billing Attention</CardTitle>
          <CardDescription>Provider invoice status</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {amountDue ? (
            <StatusIndicator
              tone="warning"
              label={`Amount due ${formatMoneyMinor(amountDue.amountRemainingMinor, amountDue.currency)} on invoice ${amountDue.invoiceNumber ?? amountDue.providerInvoiceId}`}
            />
          ) : (
            <StatusIndicator tone="success" label="No projected amount due" />
          )}
          <Button type="button" onClick={onManage} disabled={managing}>
            <ExternalLink className="h-4 w-4" />
            Manage Billing
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CurrentPlanPanel({
  data,
  checkoutPlans,
  interval,
  onIntervalChange,
  onCheckout,
  onChange,
  pending,
}: {
  data?: EffectiveEntitlements;
  checkoutPlans?: MasterPlan[];
  interval: 'MONTHLY' | 'ANNUAL';
  onIntervalChange: (interval: 'MONTHLY' | 'ANNUAL') => void;
  onCheckout: (planVersionId: string) => void;
  onChange: (planVersionId: string) => void;
  pending: boolean;
}) {
  return (
    <section className="grid gap-3" aria-label="Current Plan">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={interval === 'MONTHLY' ? 'primary' : 'secondary'}
          onClick={() => onIntervalChange('MONTHLY')}
        >
          Monthly
        </Button>
        <Button
          type="button"
          variant={interval === 'ANNUAL' ? 'primary' : 'secondary'}
          onClick={() => onIntervalChange('ANNUAL')}
        >
          Annual
        </Button>
      </div>
      {data?.subscription ? (
        <Card>
          <CardHeader>
            <CardTitle>{data.subscription.masterPlan.displayName}</CardTitle>
            <CardDescription>
              {data.subscription.status}
              {data.subscription.pendingChangeEffectiveAt
                ? ` | Pending change ${data.subscription.pendingChangeEffectiveAt}`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.features.map((feature) => (
              <Badge key={feature.key} variant={feature.enabled ? 'success' : 'neutral'}>
                {feature.key}: {feature.enabled ? 'on' : 'off'}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="No active subscription configured"
          description="Choose an eligible public plan to start hosted Checkout."
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {checkoutPlans?.flatMap((plan) =>
          plan.versions
            .filter((version) => version.status === 'PUBLISHED')
            .flatMap((version) =>
              (plan.prices ?? [])
                .filter(
                  (price) =>
                    price.planVersionId === version.id &&
                    price.status === 'ACTIVE' &&
                    price.interval === interval,
                )
                .map((price) => {
                  const current = data?.subscription?.planVersionId === version.id;
                  return (
                    <Card key={price.id}>
                      <CardHeader>
                        <CardTitle>{plan.displayName}</CardTitle>
                        <CardDescription>
                          {price.interval} | {formatMoneyMinor(price.amountMinor, price.currency)}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button
                          type="button"
                          disabled={pending || current}
                          onClick={() =>
                            data?.subscription ? onChange(version.id) : onCheckout(version.id)
                          }
                        >
                          {current
                            ? 'Current Plan'
                            : data?.subscription
                              ? 'Request Plan Change'
                              : 'Start Checkout'}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                }),
            ),
        )}
      </div>
    </section>
  );
}

function PaymentMethodPanel({
  summary,
  onManage,
  pending,
}: {
  summary?: PaymentMethodSummary | null;
  onManage: () => void;
  pending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Method</CardTitle>
        <CardDescription>
          Safe summary only; changes happen in Stripe Customer Portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {summary ? (
          <div className="flex flex-wrap items-center gap-2">
            <CreditCard className="h-4 w-4" />
            <span>{summary.displayBrand}</span>
            {summary.last4 ? <Badge variant="neutral">ending {summary.last4}</Badge> : null}
            {summary.expMonth && summary.expYear ? (
              <Badge variant="neutral">
                {summary.expMonth}/{summary.expYear}
              </Badge>
            ) : null}
            {summary.isDefault ? <Badge variant="success">Default</Badge> : null}
          </div>
        ) : (
          <EmptyState title="No payment method" description="Open Customer Portal to add one." />
        )}
        <Button type="button" onClick={onManage} disabled={pending}>
          <ExternalLink className="h-4 w-4" />
          Manage Billing
        </Button>
      </CardContent>
    </Card>
  );
}

function InvoicesPanel({
  invoices,
  loading,
  onRefresh,
  refreshing,
}: {
  invoices?: BillingInvoice[];
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (loading) return <CardSkeleton />;
  return (
    <section className="grid gap-3" aria-label="Invoices">
      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className="h-4 w-4" />
          Refresh Invoices
        </Button>
      </div>
      {!invoices?.length ? (
        <EmptyState title="No invoices" description="Stripe invoice projections appear here." />
      ) : null}
      {invoices?.map((invoice) => (
        <Card key={invoice.id}>
          <CardHeader>
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <CardTitle>{invoice.invoiceNumber ?? invoice.providerInvoiceId}</CardTitle>
                <CardDescription>
                  {invoice.status} | {new Date(invoice.providerCreatedAt).toLocaleDateString()}
                </CardDescription>
              </div>
              <Badge variant={invoice.status === 'paid' ? 'success' : 'warning'}>
                {formatMoneyMinor(invoice.amountDueMinor, invoice.currency)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <span>Paid {formatMoneyMinor(invoice.amountPaidMinor, invoice.currency)}</span>
            <span>
              Remaining {formatMoneyMinor(invoice.amountRemainingMinor, invoice.currency)}
            </span>
            {invoice.hostedInvoiceUrl ? (
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[hsl(var(--secondary))] px-4 text-sm font-semibold text-[hsl(var(--secondary-foreground))] transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2"
                href={invoice.hostedInvoiceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <FileText className="h-4 w-4" />
                Hosted Invoice
              </a>
            ) : null}
            {invoice.invoicePdfUrl ? (
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[hsl(var(--secondary))] px-4 text-sm font-semibold text-[hsl(var(--secondary-foreground))] transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2"
                href={invoice.invoicePdfUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
                PDF
              </a>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function BillingHistoryPanel({
  items,
  loading,
}: {
  items?: BillingHistoryItem[];
  loading: boolean;
}) {
  if (loading) return <CardSkeleton />;
  if (!items?.length) {
    return <EmptyState title="No billing history" description="Lifecycle events appear here." />;
  }
  return (
    <section className="grid gap-3" aria-label="Billing History">
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4" />
              <span>{item.label}</span>
            </div>
            <span className="text-sm text-[hsl(var(--muted-foreground))]">
              {new Date(item.createdAt).toLocaleString()}
            </span>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function SubscriptionPanel({
  subscription,
  onManage,
  onCancel,
  pending,
}: {
  subscription: EffectiveEntitlements['subscription'] | undefined | null;
  onManage: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  if (!subscription) {
    return (
      <EmptyState
        title="No subscription"
        description="Start hosted Checkout from the Current Plan tab."
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{subscription.masterPlan.displayName}</CardTitle>
        <CardDescription>
          {subscription.status}
          {subscription.currentPeriodEnd ? ` | Period ends ${subscription.currentPeriodEnd}` : ''}
          {subscription.cancelAtPeriodEnd ? ' | Cancels at period end' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button type="button" onClick={onManage} disabled={pending}>
          Manage Billing
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={pending || subscription.cancelAtPeriodEnd}
        >
          Cancel at Period End
        </Button>
      </CardContent>
    </Card>
  );
}

export function AgencyPlanUsagePage() {
  const selectedAgencyId = useSessionStore((state) => state.selectedAgencyId);
  const selectedAgency = useSessionStore((state) =>
    state.agencies.find((item) => item.id === state.selectedAgencyId),
  );
  const usageQuery = useQuery({
    queryKey: billingKeys.agencyUsage(selectedAgencyId),
    queryFn: () => getAgencyUsage(selectedAgencyId as string),
    enabled: Boolean(selectedAgencyId),
  });

  if (!selectedAgencyId) {
    return (
      <PageContainer>
        <EmptyState title="Switch Agency" description="Select an Agency to view usage." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Plan & Usage"
        description="Agency allocation and usage without financial account details"
        actions={<Badge variant="info">Allocation only</Badge>}
      />
      {usageQuery.isLoading ? <CardSkeleton /> : null}
      <UsageGrid
        title="Agency Resources"
        resources={usageQuery.data?.resources}
        emptyLabel="No Agency allocation has been configured."
      />
      <AllocationManagementGrid
        scope="AGENCY"
        agencyId={selectedAgencyId}
        parentResources={usageQuery.data?.resources}
        rows={
          selectedAgency?.workspaces.map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
            status: workspace.status,
          })) ?? []
        }
      />
    </PageContainer>
  );
}

function AllocationManagementGrid({
  scope,
  superAgencyId,
  agencyId,
  parentResources,
  rows,
}: {
  scope: 'SUPER_AGENCY' | 'AGENCY';
  superAgencyId?: string | null;
  agencyId?: string | null;
  parentResources?: BillingResourceSummary[];
  rows: Array<{ id: string; name: string; status: string }>;
}) {
  const queryClient = useQueryClient();
  const usageQueries = useQueries({
    queries: rows.map((row) => ({
      queryKey:
        scope === 'SUPER_AGENCY'
          ? billingKeys.agencyUsage(row.id)
          : billingKeys.workspaceUsage(row.id),
      queryFn:
        scope === 'SUPER_AGENCY' ? () => getAgencyUsage(row.id) : () => getWorkspaceUsage(row.id),
      enabled: scope === 'SUPER_AGENCY' ? Boolean(superAgencyId) : Boolean(agencyId),
    })),
  });

  const mutation = useMutation({
    mutationFn: (input: {
      rowId: string;
      resourceKey: string;
      allocated?: number;
      unlimited?: boolean;
    }) =>
      scope === 'SUPER_AGENCY'
        ? updateAgencyAllocation(superAgencyId as string, input.rowId, input)
        : updateWorkspaceAllocation(agencyId as string, input.rowId, input),
    onSuccess: async (_data, input) => {
      if (scope === 'SUPER_AGENCY') {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: billingKeys.superAgencyUsage(superAgencyId ?? null),
          }),
          queryClient.invalidateQueries({ queryKey: billingKeys.agencyUsage(input.rowId) }),
        ]);
      } else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: billingKeys.agencyUsage(agencyId ?? null) }),
          queryClient.invalidateQueries({ queryKey: billingKeys.workspaceUsage(input.rowId) }),
        ]);
      }
      toast.success('Allocation updated');
    },
    onError: async (_error, input) => {
      if (scope === 'SUPER_AGENCY') {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: billingKeys.superAgencyUsage(superAgencyId ?? null),
          }),
          queryClient.invalidateQueries({ queryKey: billingKeys.agencyUsage(input.rowId) }),
        ]);
      } else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: billingKeys.agencyUsage(agencyId ?? null) }),
          queryClient.invalidateQueries({ queryKey: billingKeys.workspaceUsage(input.rowId) }),
        ]);
      }
      toast.error('Allocation update failed; refreshed capacity.');
    },
  });

  if (!rows.length) {
    return (
      <EmptyState
        title={scope === 'SUPER_AGENCY' ? 'No Agencies' : 'No Workspaces'}
        description="Allocation rows appear after child tenants exist."
      />
    );
  }

  return (
    <section className="grid gap-3" aria-label="Allocation management">
      <PageHeader
        title={scope === 'SUPER_AGENCY' ? 'Agency Allocations' : 'Workspace Allocations'}
        description="Capacity controls only; financial account records are not shown."
        actions={<Badge variant="info">Backend enforced</Badge>}
      />
      {rows.map((row, index) => {
        const usage = usageQueries[index]?.data;
        return (
          <Card key={row.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{row.name}</CardTitle>
                  <CardDescription>{row.status}</CardDescription>
                </div>
                <Badge variant={hasOverLimit(usage?.resources) ? 'danger' : 'success'}>
                  {hasOverLimit(usage?.resources) ? 'OVER LIMIT' : 'Within limit'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {usageQueries[index]?.isLoading ? <CardSkeleton /> : null}
              {usage?.resources.map((resource) => (
                <AllocationResourceEditor
                  key={`${row.id}-${resource.resourceKey}`}
                  rowId={row.id}
                  resource={resource}
                  parentResource={parentResources?.find(
                    (item) => item.resourceKey === resource.resourceKey,
                  )}
                  pending={mutation.isPending}
                  onSave={(input) => mutation.mutate(input)}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function AllocationResourceEditor({
  rowId,
  resource,
  parentResource,
  pending,
  onSave,
}: {
  rowId: string;
  resource: BillingResourceSummary;
  parentResource?: BillingResourceSummary;
  pending: boolean;
  onSave: (input: {
    rowId: string;
    resourceKey: string;
    allocated?: number;
    unlimited?: boolean;
  }) => void;
}) {
  const [value, setValue] = useState(resource.limit ?? '');
  const [unlimited, setUnlimited] = useState(resource.unlimited);
  const numeric = Number(value);
  const parentLimit = parseResourceBigInt(parentResource?.limit);
  const parentUnallocated = parseResourceBigInt(parentResource?.unallocated);
  const currentLimit = resource.unlimited ? null : (parseResourceBigInt(resource.limit) ?? 0n);
  const parentFinite =
    parentResource?.configured && !parentResource.unlimited && parentLimit !== null;
  const allowedMax =
    parentFinite && parentUnallocated !== null && currentLimit !== null
      ? currentLimit + parentUnallocated
      : null;
  const requested = Number.isInteger(numeric) && numeric >= 0 ? BigInt(numeric) : null;
  const exceedsParentCapacity =
    !unlimited && allowedMax !== null && requested !== null && requested > allowedMax;
  const invalid =
    (unlimited && parentFinite) ||
    (!unlimited && (!Number.isInteger(numeric) || numeric < 0 || exceedsParentCapacity));

  return (
    <div className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
      <div>
        <p className="font-medium">{resourceLabel(resource.resourceKey)}</p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Used {formatResourceValue(resource.used)} /{' '}
          {resource.unlimited
            ? 'Unlimited'
            : resource.limit
              ? formatResourceValue(resource.limit)
              : 'Unconfigured'}{' '}
          | Remaining{' '}
          {resource.remaining === null ? 'Unlimited' : formatResourceValue(resource.remaining)}
        </p>
        {resource.status === 'OVER_LIMIT' ? (
          <p className="text-sm text-[hsl(var(--warning))]">
            Existing resources are preserved; increase allocation or reduce usage before creating
            more.
          </p>
        ) : null}
        {parentResource ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Parent capacity{' '}
            {parentResource.unlimited
              ? 'Unlimited'
              : parentResource.limit
                ? formatResourceValue(parentResource.limit)
                : 'Unconfigured'}{' '}
            | Allocated{' '}
            {parentResource.childAllocationUnlimited
              ? 'Unlimited'
              : formatResourceValue(parentResource.allocatedToChildren ?? '0')}{' '}
            | Available{' '}
            {parentResource.unallocated == null
              ? 'Unlimited'
              : formatResourceValue(parentResource.unallocated)}
          </p>
        ) : null}
        {unlimited && parentFinite ? (
          <p className="text-sm text-[hsl(var(--warning))]">
            Finite parent capacity cannot grant unlimited child allocation.
          </p>
        ) : null}
        {exceedsParentCapacity ? (
          <p className="text-sm text-[hsl(var(--warning))]">
            Requested allocation exceeds available parent capacity.
          </p>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={unlimited}
          onChange={(event) => setUnlimited(event.target.checked)}
        />
        Unlimited
      </label>
      <Input
        aria-label={`${resource.resourceKey} allocation`}
        inputMode="numeric"
        min={0}
        value={value}
        disabled={unlimited}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button
        type="button"
        disabled={pending || invalid}
        onClick={() =>
          onSave({
            rowId,
            resourceKey: resource.resourceKey,
            ...(unlimited ? { unlimited: true } : { allocated: numeric, unlimited: false }),
          })
        }
      >
        <Save className="h-4 w-4" />
        Save
      </Button>
    </div>
  );
}

function hasOverLimit(resources?: BillingResourceSummary[]) {
  return resources?.some((resource) => resource.status === 'OVER_LIMIT') ?? false;
}

function parseResourceBigInt(value?: string | null) {
  if (value === undefined || value === null) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function WorkspaceUsageLimitsPage() {
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const usageQuery = useQuery({
    queryKey: billingKeys.workspaceUsage(selectedWorkspaceId),
    queryFn: () => getWorkspaceUsage(selectedWorkspaceId as string),
    enabled: Boolean(selectedWorkspaceId),
  });

  if (!selectedWorkspaceId) {
    return (
      <PageContainer>
        <EmptyState title="Switch Workspace" description="Select a Workspace to view limits." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Usage & Limits"
        description="Workspace capacity status and locked-resource state"
        actions={<Badge variant="neutral">Read-only</Badge>}
      />
      {usageQuery.isLoading ? <CardSkeleton /> : null}
      <UsageGrid
        title="Workspace Resources"
        resources={usageQuery.data?.resources}
        emptyLabel="No Workspace allocation has been configured."
      />
    </PageContainer>
  );
}

function UsageGrid({
  title,
  resources,
  emptyLabel,
}: {
  title: string;
  resources?: BillingResourceSummary[];
  emptyLabel: string;
}) {
  if (!resources?.length) {
    return <EmptyState title={title} description={emptyLabel} />;
  }
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={title}>
      {resources.map((resource) => (
        <Card key={resource.resourceKey}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{resourceLabel(resource.resourceKey)}</CardTitle>
                <CardDescription>{resource.dimension.replace('_', ' ')}</CardDescription>
              </div>
              <Badge variant={resource.status === 'OVER_LIMIT' ? 'danger' : 'success'}>
                {resource.status === 'OVER_LIMIT' ? 'OVER LIMIT' : 'Within limit'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-end justify-between gap-3">
              <span className="text-2xl font-semibold">{formatResourceValue(resource.used)}</span>
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {resource.unlimited
                  ? 'Unlimited'
                  : resource.limit
                    ? `of ${formatResourceValue(resource.limit)}`
                    : 'Unconfigured'}
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-sm bg-[hsl(var(--muted))]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue(resource)}
            >
              <div
                className={`h-full ${resource.status === 'OVER_LIMIT' ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary))]'}`}
                style={{ width: `${progressValue(resource)}%` }}
              />
            </div>
            {resource.status === 'OVER_LIMIT' ? (
              <StatusIndicator
                tone="warning"
                label="Existing resources remain available; new growth is restricted."
              />
            ) : null}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function formatMoneyMinor(value: string, currency: string) {
  const cents = Number(value);
  const normalizedCurrency = currency.trim().toUpperCase() || 'USD';
  if (!Number.isFinite(cents)) return normalizedCurrency;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: normalizedCurrency,
  }).format(cents / 100);
}

function formatUsdMinor(value: string) {
  return formatMoneyMinor(value, 'USD');
}

function BillingAccessBadge({ level }: { level?: string }) {
  if (level === 'READ_ONLY_RESTRICTED') return <Badge variant="danger">Restricted</Badge>;
  if (level === 'FULL_WITH_WARNING') return <Badge variant="warning">Grace Period</Badge>;
  return <Badge variant="success">Active</Badge>;
}

function progressValue(resource: BillingResourceSummary) {
  const used = Number(resource.used);
  const limit = Number(resource.limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return resource.status === 'OVER_LIMIT' ? 100 : 0;
  }
  return Math.min(Math.round((used / limit) * 100), 100);
}

function formatResourceValue(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat('en-US').format(numeric);
}

function resourceLabel(key: string) {
  return key
    .toLowerCase()
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}
