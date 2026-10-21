import { Bell, BellOff, BellRing, Send, Smartphone, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { NotificationKind, PushDeliveryDto, PushServiceKind } from '@solera/protocol'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  IconButton,
  SegmentedControl,
  SwitchRow,
} from '@solera/ui'
import { ApiRequestError } from '../lib/api'
import { useLocale, useTranslate, type MessageKey } from '../lib/i18n'
import {
  pushAvailability,
  usePushDevices,
  usePushStatus,
  usePushTest,
  useRemovePushDevice,
  useSendPushTest,
  useSubscribePush,
  useUnsubscribePush,
} from '../lib/push'
import { useUpdateNotificationPrefs, useUserSettings } from '../lib/user-settings'

/** Des noms propres, qui ne se traduisent pas ; le reste passe par le catalogue. */
const SERVICES: Record<Exclude<PushServiceKind, 'other'>, string> = {
  apple: 'Apple',
  google: 'Google',
  mozilla: 'Mozilla',
  microsoft: 'Microsoft',
}

/**
 * Le système et le navigateur, lus dans l'en-tête de l'appareil qui s'est abonné.
 * `null` quand rien n'y est reconnaissable : l'appelant dit alors « appareil inconnu ».
 */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null
  const system = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : null
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent) && !/Chromium/.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null
  if (browser && system) return `${browser} · ${system}`
  return browser ?? system
}

/** Sur iPhone, les notifications n'existent que pour l'application ajoutée à l'écran d'accueil. */
function iosOutsideHomeScreen(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && !standalone
}

/**
 * Les notifications : cet appareil, tous ceux du compte, un essai, et ce qui notifie.
 *
 * L'abonnement vaut par appareil : le même compte sur un téléphone et sur un ordinateur
 * a deux abonnements distincts. L'état affiché est celui de **cet** appareil, lu en
 * comparant son propre abonnement à la liste du compte : un téléphone abonné ne dit
 * rien de cet ordinateur. Les sortes, elles, valent pour tous les appareils.
 */
export function PushControls() {
  const availability = pushAvailability()
  const t = useTranslate()
  if (availability === 'insecure') return <Banner tone="info">{t('push.insecure')}</Banner>
  if (availability === 'unsupported') {
    return <Banner tone="info">{t(iosOutsideHomeScreen() ? 'push.iosHomeScreen' : 'push.unsupported')}</Banner>
  }
  return (
    <div className="flex flex-col gap-4">
      <ThisDevice />
      <Devices />
      <PushTest />
      <Preferences />
    </div>
  )
}

function ThisDevice() {
  const t = useTranslate()
  const { data: status } = usePushStatus(true)
  const { data: devices } = usePushDevices(true)
  const subscribe = useSubscribePush()
  const unsubscribe = useUnsubscribePush()
  const subscribed = Boolean(
    devices?.current && devices.devices.some((device) => device.endpoint === devices.current),
  )
  const busy = subscribe.isPending || unsubscribe.isPending
  const error =
    subscribe.error instanceof Error
      ? subscribe.error.message
      : unsubscribe.error instanceof ApiRequestError
        ? unsubscribe.error.message
        : null

  return (
    <Card>
      <CardHeader
        title={t('push.thisDevice')}
        icon={<Bell size={16} />}
        // L'état avant le bouton : « Activer » seul ne dit pas si c'est déjà fait, et on
        // vient souvent ici pour le vérifier.
        actions={
          devices ? (
            <Badge tone={subscribed ? 'positive' : 'neutral'}>
              {t(subscribed ? 'push.status.on' : 'push.status.off')}
            </Badge>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">{t('push.description')}</p>
        {subscribed ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<BellOff size={14} />}
            disabled={busy}
            onClick={() => unsubscribe.mutate()}
            className="self-start"
          >
            {t('push.disable')}
          </Button>
        ) : (
          <Button
            size="sm"
            icon={<Bell size={14} />}
            disabled={busy || !status || !devices}
            onClick={() => status && subscribe.mutate(status.publicKey)}
            className="self-start"
          >
            {t('push.enable')}
          </Button>
        )}
        {error ? <Banner>{error}</Banner> : null}
      </CardBody>
    </Card>
  )
}

function Devices() {
  const t = useTranslate()
  const locale = useLocale()
  const { data } = usePushDevices(true)
  const remove = useRemovePushDevice()
  if (!data) return null
  return (
    <Card>
      <CardHeader
        title={t('push.devices.title')}
        description={t('push.devices.hint')}
        icon={<Smartphone size={16} />}
      />
      <CardBody>
        {data.devices.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('push.devices.none')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.devices.map((device) => (
              <li key={device.endpoint} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    {describeDevice(device.userAgent) ?? t('push.devices.unknown')}
                    {device.endpoint === data.current ? (
                      <Badge tone="accent">{t('push.devices.current')}</Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {t(device.service === 'other' ? 'push.devices.since' : 'push.devices.meta', {
                      service: device.service === 'other' ? '' : SERVICES[device.service],
                      date: new Date(device.createdAt).toLocaleDateString(locale),
                    })}
                  </p>
                </div>
                <IconButton
                  size="sm"
                  label={t('push.devices.remove')}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(device.endpoint)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

type Delay = '0' | '10' | '30'

function PushTest() {
  const t = useTranslate()
  const [delay, setDelay] = useState<Delay>('10')
  const send = useSendPushTest()
  const { data: test } = usePushTest(send.data?.id ?? null)
  const waiting = Boolean(send.data && !test?.deliveries)
  const secondsLeft = Math.max(0, Math.round(((send.data?.sendAt ?? 0) - Date.now()) / 1000))

  return (
    <Card>
      <CardHeader title={t('push.test.title')} description={t('push.test.hint')} icon={<BellRing size={16} />} />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<Delay>
            label={t('push.test.delay')}
            value={delay}
            onChange={setDelay}
            segments={[
              { value: '0', label: t('push.test.now') },
              { value: '10', label: t('push.test.seconds', { count: 10 }) },
              { value: '30', label: t('push.test.seconds', { count: 30 }) },
            ]}
          />
          <Button
            size="sm"
            icon={<Send size={14} />}
            disabled={send.isPending || waiting}
            onClick={() => send.mutate(Number(delay))}
          >
            {t('push.test.send')}
          </Button>
        </div>
        {waiting ? (
          <p role="status" className="text-sm text-ink-soft">
            {t('push.test.waiting', { seconds: secondsLeft })}
          </p>
        ) : null}
        {test?.deliveries ? <Deliveries deliveries={test.deliveries} /> : null}
        {send.error instanceof Error ? <Banner>{send.error.message}</Banner> : null}
      </CardBody>
    </Card>
  )
}

const OUTCOMES: Record<PushDeliveryDto['outcome'], MessageKey> = {
  sent: 'push.test.outcome.sent',
  failed: 'push.test.outcome.failed',
  removed: 'push.test.outcome.removed',
}

/** Le résultat par appareil : c'est ce qui dit lequel n'a rien reçu, et pourquoi. */
function Deliveries({ deliveries }: { deliveries: PushDeliveryDto[] }) {
  const t = useTranslate()
  const { data } = usePushDevices(true)
  if (deliveries.length === 0) return <Banner tone="caution">{t('push.test.noDevice')}</Banner>
  const label = (delivery: PushDeliveryDto) => {
    const device = data?.devices.find((candidate) => candidate.endpoint === delivery.endpoint)
    if (device) return describeDevice(device.userAgent) ?? t('push.devices.unknown')
    // Un abonnement retiré pendant l'essai n'est plus dans la liste : reste son service.
    return delivery.service === 'other' ? t('push.devices.unknown') : SERVICES[delivery.service]
  }
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {deliveries.map((delivery) => (
        <li key={delivery.endpoint} className="flex flex-wrap items-center gap-2">
          <Badge tone={delivery.outcome === 'sent' ? 'positive' : 'critical'}>{t(OUTCOMES[delivery.outcome])}</Badge>
          <span className="text-ink-soft">{label(delivery)}</span>
          {delivery.reason ? (
            <span className="text-xs text-ink-faint">
              {delivery.status ? `${delivery.status} · ` : ''}
              {delivery.reason}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * Les sortes, dans l'ordre où elles dérangent : une demande bloque une session, une fin
 * de tour ne bloque rien. Une sorte nouvelle s'ajoute ici avec ses deux libellés.
 */
const KINDS: Array<{ kind: NotificationKind; label: MessageKey; hint: MessageKey }> = [
  { kind: 'cliRequest', label: 'push.prefs.cliRequest', hint: 'push.prefs.cliRequest.hint' },
  { kind: 'turnCompleted', label: 'push.prefs.turnCompleted', hint: 'push.prefs.turnCompleted.hint' },
]

function Preferences() {
  const t = useTranslate()
  const { data: settings } = useUserSettings()
  const update = useUpdateNotificationPrefs()
  if (!settings) return null
  const prefs = settings.notifications
  return (
    <Card>
      <CardHeader
        title={t('push.prefs.title')}
        description={t('push.prefs.hint')}
        icon={<SlidersHorizontal size={16} />}
      />
      <CardBody className="flex flex-col gap-1">
        {KINDS.map((entry) => (
          <SwitchRow
            key={entry.kind}
            checked={prefs[entry.kind]}
            label={t(entry.label)}
            description={t(entry.hint)}
            onCheckedChange={(value) => update.mutate({ ...prefs, [entry.kind]: value })}
          />
        ))}
        {update.error instanceof ApiRequestError ? <Banner>{update.error.message}</Banner> : null}
      </CardBody>
    </Card>
  )
}
