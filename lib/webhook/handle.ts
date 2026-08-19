import { periodKey } from "../daykey";
import { decide } from "../engine/decide";
import { matchKeyword } from "../match/keyword";
import { decodePostback } from "../match/postback";
import { decodeRichMenuPostback } from "../richmenu/postback";
import { renderCard, type LineMessage } from "../render/card";
import type { PlayerState } from "../state";
import { FALLBACK } from "./messages";
import type { ActivityConfig, LiveCampaign, Ports } from "./ports";

/** A LINE webhook event, narrowed to the shapes this slice answers. */
export type IncomingEvent = {
  type: string;
  replyToken?: string;
  source?: { type?: string; userId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string; params?: Record<string, unknown> };
};

export type Handled =
  | {
      replyToken: string;
      message: LineMessage;
      /**
       * Set only the first time this participant's message matches a keyword
       * (BR-78's per-user side). The actual LINE call and the "linked" write
       * both happen at the route, after the reply is sent — never here, so a
       * handler under test never touches the network.
       */
      linkRichMenu?: { participantId: string; lineUid: string; richMenuId: string };
    }
  | null;

type Reply = (
  message: LineMessage,
  meta: {
    activityId: string | null;
    eventType: string;
    postbackData?: string | null;
    result?: unknown;
  },
) => Promise<Handled>;

const text = (t: string): LineMessage => ({ type: "text", text: t });

function cardMessage(
  campaign: LiveCampaign,
  cardId: string | null | undefined,
  state: PlayerState,
  whenMissing: string,
): LineMessage {
  const card = cardId ? campaign.cardsById[cardId] : undefined;
  return card ? renderCard(card, state, campaign.theme) : text(whenMissing);
}

/**
 * Every branch below ends in a message. There is no path that returns nothing
 * for an event carrying a reply token, because a tap that produces silence is
 * indistinguishable from a broken bot (BR-01).
 */
export async function handleEvent(
  event: IncomingEvent,
  lineChannelId: string,
  ports: Ports,
  now: Date,
  rng: () => number,
): Promise<Handled> {
  const started = Date.now();

  // A rich-menu tab switch reports itself here. LINE has already swapped the
  // image; this is only the outcome. It must be recognised before the payload is
  // read, because it carries none of our own fields — left to fall through it
  // would answer "this campaign has ended" every time someone taps a tab.
  if (
    event.type === "postback" &&
    event.postback?.params?.status !== undefined
  ) {
    return null;
  }

  if (!event.replyToken) return null;

  // Group chats are shared space. A campaign speaks to individuals.
  if (event.source?.type && event.source.type !== "user") return null;

  const lineUid = event.source?.userId;
  if (!lineUid) return null;

  const campaign = await ports.findLiveCampaign(lineChannelId);
  if (!campaign) {
    return {
      replyToken: event.replyToken,
      message: text(FALLBACK.campaignOver),
    };
  }

  const participantId = await ports.ensureParticipant(lineChannelId, lineUid);
  const state = await ports.loadPlayerState(participantId, campaign.campaignId);
  const today = periodKey(now, campaign.timezone, campaign.dayLengthSec);

  const replyToken = event.replyToken;
  const reply: Reply = async (message, meta) => {
    await ports.logEvent({
      participantId,
      activityId: meta.activityId,
      configVersionId: campaign.configVersionId,
      eventType: meta.eventType,
      postbackData: meta.postbackData ?? null,
      result: meta.result ?? null,
      durationMs: Date.now() - started,
    });
    return { replyToken, message };
  };

  // ── ปุ่มบน Rich Menu ───────────────────────────────────────────────
  if (event.type === "postback") {
    const raw = event.postback?.data ?? "";

    // เมนูแขวนอยู่ในแชทถาวร ไม่ได้ "ออก" ในวันใดวันหนึ่งเหมือนการ์ด จึงมี payload
    // คนละรูปแบบและไม่มีการเช็คหมดอายุแบบ d= เลย (ดู lib/richmenu/postback.ts) —
    // ลองรูปแบบนี้ก่อนเสมอ เพราะ decodePostback (ปุ่มบนการ์ด) ไม่รู้จักคีย์ rm/card
    // และจะปฏิเสธมันอยู่แล้ว การลองก่อนจึงไม่กระทบพฤติกรรมของปุ่มบนการ์ดเลย
    const richMenuPayload = decodeRichMenuPostback(raw);
    if (richMenuPayload) {
      if (richMenuPayload.c !== campaign.code) {
        return reply(text(FALLBACK.campaignOver), {
          activityId: null,
          eventType: "campaign_over",
          postbackData: raw,
        });
      }

      if (richMenuPayload.a !== undefined) {
        const activity = campaign.activities.find(
          (a) => a.code === richMenuPayload.a,
        );
        if (!activity) {
          return reply(text(FALLBACK.campaignOver), {
            activityId: null,
            eventType: "activity_missing",
            postbackData: raw,
          });
        }
        return playActivity({
          activity,
          raw,
          campaign,
          participantId,
          state,
          today,
          now,
          rng,
          ports,
          reply,
        });
      }

      return reply(
        cardMessage(campaign, richMenuPayload.card, state, FALLBACK.systemDown),
        {
          activityId: null,
          eventType: "richmenu_card",
        },
      );
    }
  }

  // ── ปุ่มบนการ์ด ────────────────────────────────────────────────────
  if (event.type === "postback") {
    const raw = event.postback?.data ?? "";
    const payload = decodePostback(raw);

    if (!payload) {
      return reply(text(FALLBACK.systemDown), {
        activityId: null,
        eventType: "postback_unreadable",
        postbackData: raw,
      });
    }
    if (payload.c !== campaign.code) {
      return reply(text(FALLBACK.campaignOver), {
        activityId: null,
        eventType: "campaign_over",
        postbackData: raw,
      });
    }
    if (payload.d !== today) {
      return reply(text(FALLBACK.cardExpired), {
        activityId: null,
        eventType: "card_expired",
        postbackData: raw,
      });
    }

    const activity = campaign.activities.find((a) => a.code === payload.a);
    if (!activity) {
      return reply(text(FALLBACK.campaignOver), {
        activityId: null,
        eventType: "activity_missing",
        postbackData: raw,
      });
    }

    return playActivity({
      activity,
      pickedId: payload.p,
      raw,
      campaign,
      participantId,
      state,
      today,
      now,
      rng,
      ports,
      reply,
    });
  }

  // ── พิมพ์ข้อความ ────────────────────────────────────────────────────
  if (event.type === "message" && event.message?.type === "text") {
    const said = event.message.text ?? "";
    const rule = matchKeyword(said, campaign.keywordRules);
    const target = rule ? campaign.keywordTargets[rule.id] : undefined;

    // A keyword actually matched (not the unmatched-text fallback below) and
    // this campaign has an entry menu on LINE — link it the first time only.
    // The real LINE call happens at the route; a handler under test never
    // touches the network, and a failed call never gets marked as done, so
    // the very next message tries again.
    const linkRichMenu =
      rule && campaign.entryRichMenuLineId && !(await ports.hasRichMenuLinked(participantId))
        ? { participantId, lineUid, richMenuId: campaign.entryRichMenuLineId }
        : undefined;
    const withLink = (handled: Handled): Handled =>
      handled && linkRichMenu ? { ...handled, linkRichMenu } : handled;

    if (target?.activityId) {
      const activity = campaign.activities.find(
        (a) => a.id === target.activityId,
      );
      if (activity)
        return withLink(
          await playActivity({
            activity,
            raw: null,
            campaign,
            participantId,
            state,
            today,
            now,
            rng,
            ports,
            reply,
          }),
        );
    }
    if (target?.cardId) {
      return withLink(
        await reply(
          cardMessage(campaign, target.cardId, state, FALLBACK.systemDown),
          {
            activityId: null,
            eventType: "keyword_card",
          },
        ),
      );
    }

    return withLink(
      await reply(
        cardMessage(campaign, campaign.defaultCardId, state, FALLBACK.systemDown),
        {
          activityId: null,
          eventType: "text_unmatched",
        },
      ),
    );
  }

  // ── แอดเป็นเพื่อน ───────────────────────────────────────────────────
  if (event.type === "follow") {
    if (!campaign.greetingEnabled) return null;

    const greeting = campaign.activities.find((a) => a.trigger === "follow");
    if (greeting)
      return playActivity({
        activity: greeting,
        raw: null,
        campaign,
        participantId,
        state,
        today,
        now,
        rng,
        ports,
        reply,
      });

    return reply(
      cardMessage(
        campaign,
        campaign.greetingCardId,
        state,
        FALLBACK.systemDown,
      ),
      {
        activityId: null,
        eventType: "follow",
      },
    );
  }

  return null;
}

/** One play, from entry check through to the card the player sees. */
async function playActivity(args: {
  activity: ActivityConfig;
  pickedId?: string;
  raw: string | null;
  campaign: LiveCampaign;
  participantId: string;
  state: PlayerState;
  today: string;
  now: Date;
  rng: () => number;
  ports: Ports;
  reply: Reply;
}): Promise<Handled> {
  const {
    activity,
    pickedId,
    raw,
    campaign,
    participantId,
    state,
    today,
    now,
    rng,
    ports,
    reply,
  } = args;

  const playsThisPeriod = await ports.playsThisPeriod(
    participantId,
    activity.id,
    today,
  );

  const decision = decide({
    entryRules: activity.entryRules,
    resolveMethod: activity.resolveMethod,
    outcomes: activity.outcomes,
    effectSpec: activity.effectSpec,
    input: { pickedId },
    ctx: {
      state,
      now,
      playsThisPeriod,
      campaignStart: campaign.startAt,
      campaignEnd: campaign.endAt,
    },
    rng,
    fallbackCardId: activity.fallbackCardId ?? undefined,
  });

  if (decision.kind === "blocked") {
    return reply(
      cardMessage(campaign, decision.cardId, state, FALLBACK.nothingLeft),
      {
        activityId: activity.id,
        eventType: "entry_blocked",
        postbackData: raw,
      },
    );
  }

  const played = await ports.play({
    participantId,
    activity,
    campaignId: campaign.campaignId,
    periodKey: today,
    configVersionId: campaign.configVersionId,
    ranked: decision.ranked,
  });

  if (played.kind === "exhausted") {
    return reply(
      cardMessage(
        campaign,
        activity.fallbackCardId,
        state,
        FALLBACK.nothingLeft,
      ),
      {
        activityId: activity.id,
        eventType: "exhausted",
        postbackData: raw,
      },
    );
  }

  // The state the card is drawn against must include what just happened,
  // otherwise a card that shows the new total shows the old one.
  const after: PlayerState = { ...state, lastResult: played.outcomeId };

  return reply(
    cardMessage(campaign, played.cardId, after, FALLBACK.systemDown),
    {
      activityId: activity.id,
      eventType: played.kind === "replayed" ? "replay" : "play",
      postbackData: raw,
      result: { outcomeId: played.outcomeId },
    },
  );
}
