import type { TypeContent } from '@/lib/mbti/content/types'
import type { MbtiType } from '@/lib/mbti/types'

/**
 * English content for the 16 type pages.
 *
 * These pages are free, statically generated, and are one of only two distribution
 * channels this product has (the other is the invite link). They are written to be worth
 * landing on from a search result, not as filler behind a paywall.
 *
 * Tone rule: describe behaviour someone can recognise in themselves, and name the cost of
 * each strength. A type page that only flatters reads as a horoscope and earns no trust
 * for the paid pair report that follows it.
 */
export const TYPES_EN: Record<MbtiType, TypeContent> = {
  ENFJ: {
    nickname: 'The Teacher',
    tagline: 'You read the room before you read the agenda, and you have usually already decided who needs help.',
    overview: [
      'You notice what people need before they say it, and you find it hard not to act on that. In groups you end up holding things together almost by reflex, and often nobody names it because you make it look easy.',
      'The cost is that your attention runs outward by default. You will spend a week solving someone else\'s problem and only notice on Sunday that you have not thought about your own.',
    ],
    strengths: [
      'You can tell what a group is actually feeling, not what it is saying',
      'People trust you quickly and tell you real things',
      'You turn a vague shared intention into something people actually do',
      'You give hard feedback in a way that lands without wounding',
    ],
    growth: [
      'Saying no without building a justification for it first',
      'Letting someone struggle when the struggle is the point',
      'Noticing when "helping" has become a way to avoid your own work',
    ],
    inRelationships:
      'You invest early and deeply, which is wonderful and occasionally overwhelming for someone who moves slower. Your hardest moment is realising that being needed and being loved are not the same thing.',
  },
  ENFP: {
    nickname: 'The Champion',
    tagline: 'You can find the interesting thread in almost anything, which is why you have started so many projects.',
    overview: [
      'Possibility is the thing that moves you. A conversation about what something could become will hold you far longer than a conversation about what it currently is, and you are genuinely good at making other people see it too.',
      'The same wiring makes finishing hard. The idea is most alive at the beginning, and by the middle it has become logistics, which is the part your attention slides off.',
    ],
    strengths: [
      'You see the potential in people before they see it themselves',
      'You connect ideas from places that seem unrelated',
      'Your enthusiasm is real and it moves other people',
      'You are unusually comfortable changing your mind',
    ],
    growth: [
      'Finishing one thing before the next idea arrives',
      'Sitting with a boring middle instead of escaping into a new beginning',
      'Telling the difference between a real opportunity and a novel one',
    ],
    inRelationships:
      'You bring energy and a genuine curiosity about who someone is. The friction is consistency: the people closest to you need the version of your attention that shows up on an ordinary Tuesday, not only the version that lights up on a good night.',
  },
  ENTJ: {
    nickname: 'The Executive',
    tagline: 'You see where this is going and you have already worked out who needs to do what.',
    overview: [
      'You organise instinctively. Given a vague situation you will produce a direction, a sequence, and an owner for each part, usually faster than anyone asked you to.',
      'That decisiveness is your value and your blind spot. You move before consensus arrives, and sometimes the thing you steamrolled was a legitimate objection you did not slow down enough to hear.',
    ],
    strengths: [
      'You turn ambiguity into a plan people can act on',
      'You make decisions others postpone',
      'You are comfortable being accountable for the outcome',
      'You think several moves ahead without losing the current one',
    ],
    growth: [
      'Hearing a slow objection all the way through',
      'Noticing that your certainty can silence a room',
      'Valuing something that is working even when you did not design it',
    ],
    inRelationships:
      'You show love through effort: you fix things, you plan things, you make problems go away. What tends to be missing is the version where you sit with someone in a problem you cannot solve.',
  },
  ENTP: {
    nickname: 'The Inventor',
    tagline: 'You argue the other side because you want to see if the idea survives it.',
    overview: [
      'You think by testing. Given a claim, your instinct is to push on it and find where it breaks, and you enjoy this more than most people expect you to.',
      'This makes you very good at finding the flaw and less reliably good at building the replacement. The interesting part of a problem, for you, is the part before it becomes work.',
    ],
    strengths: [
      'You find the hole in a plan that everyone else nodded through',
      'You are genuinely comfortable being wrong out loud',
      'You generate options quickly when everyone is stuck on one',
      'You connect a problem to something from a completely different domain',
    ],
    growth: [
      'Knowing when the debate has stopped being useful',
      'Building the thing, not just the case for it',
      'Noticing when pushing back is curiosity and when it is habit',
    ],
    inRelationships:
      'You are stimulating company and you make people think. The recurring friction is that not every statement is an invitation to debate, and someone who is upset usually wants to be heard rather than corrected.',
  },
  ESFJ: {
    nickname: 'The Provider',
    tagline: 'You remember who does not eat dairy, and you noticed they went quiet twenty minutes ago.',
    overview: [
      'You keep the practical fabric of a group intact. You remember the details about people that make them feel known, and you act on them without making a production of it.',
      'Because harmony matters to you, conflict registers as something to fix rather than something to sit inside. That instinct resolves a lot of small friction and occasionally buries a real disagreement.',
    ],
    strengths: [
      'You make people feel genuinely looked after',
      'You follow through on what you said you would do',
      'You notice when someone has gone quiet',
      'You keep traditions and rituals alive that others would let lapse',
    ],
    growth: [
      'Letting a disagreement stay open long enough to be resolved properly',
      'Asking for what you need instead of hoping it is noticed',
      'Separating "they are upset" from "I did something wrong"',
    ],
    inRelationships:
      'You are steady, warm, and reliably present. The pattern to watch is quiet score-keeping: giving a great deal, not naming what you need back, and then feeling unseen for reasons the other person never had a chance to hear.',
  },
  ESFP: {
    nickname: 'The Performer',
    tagline: 'You are fully in the room, which is why the room is better when you are in it.',
    overview: [
      'You live in the present more completely than most people manage. You notice texture, mood, and the actual moment, and you pull other people into it with you.',
      'The flip side is that things which pay off slowly and invisibly get neglected. Long-term plans compete with a vivid present, and the present usually wins.',
    ],
    strengths: [
      'You make ordinary moments feel like something',
      'You read a room and adapt to it instantly',
      'You are practical in a crisis while others are still processing',
      'You are warm without effort or calculation',
    ],
    growth: [
      'Sitting with something uncomfortable instead of changing the subject',
      'Following through on the boring part after the exciting part ends',
      'Planning for a future that does not feel real yet',
    ],
    inRelationships:
      'You are generous, fun, and physically present in a way people remember. The hard part is the unglamorous maintenance of a long relationship, which asks for attention on days when nothing is happening.',
  },
  ESTJ: {
    nickname: 'The Supervisor',
    tagline: 'You said you would handle it, so it is handled.',
    overview: [
      'You are the reason things actually happen on the date they were supposed to. You set up structure, you hold people to what was agreed, and you do not find that uncomfortable.',
      'Your risk is treating the process as the point. A rule that worked last year can outlive its usefulness, and you are more likely to enforce it than to reopen it.',
    ],
    strengths: [
      'You deliver what you committed to, consistently',
      'You bring order to situations that were drifting',
      'You say the direct thing when everyone else is hedging',
      'You are dependable in a way people quietly build their plans around',
    ],
    growth: [
      'Asking whether a rule still serves its original purpose',
      'Hearing an unconventional approach out before ruling on it',
      'Recognising that efficiency is not the only thing worth optimising',
    ],
    inRelationships:
      'You are loyal and you show up, which is worth more than most grand gestures. What is easy to miss is that being right about a disagreement does not settle it; the other person still has to feel heard.',
  },
  ESTP: {
    nickname: 'The Promoter',
    tagline: 'You would rather try it and find out than sit in another meeting about it.',
    overview: [
      'You are calibrated for real time. You read situations fast, act on incomplete information, and are usually correct enough, which is a rarer skill than it sounds.',
      'That bias toward action makes slow deliberate work feel like friction. You are excellent when something is happening and restless when nothing is.',
    ],
    strengths: [
      'You act decisively while others are still gathering information',
      'You stay calm and useful when something goes wrong',
      'You read people quickly and accurately',
      'You are unafraid of risk that is actually worth taking',
    ],
    growth: [
      'Thinking past the immediate move to the one after it',
      'Sitting through a process that cannot be shortcut',
      'Noticing when "decisive" has become "impatient"',
    ],
    inRelationships:
      'You are exciting and you make things happen. The recurring difficulty is depth over time: the conversations that matter most in a long relationship are slow ones, and slow is the mode you find hardest to stay in.',
  },
  INFJ: {
    nickname: 'The Counselor',
    tagline: 'You understood what was going on with them before they had words for it, and you said nothing.',
    overview: [
      'You perceive patterns in people that you cannot always explain. You often know where something is heading well before there is evidence, and you are usually right often enough that it unsettles people.',
      'You are also more private than you appear. You draw others out easily and give back a curated version of yourself, which can leave you known by many and understood by very few.',
    ],
    strengths: [
      'You understand people at a depth they rarely encounter',
      'You hold to a conviction even when it costs you',
      'You see the long arc, not just the current moment',
      'You give the kind of advice people remember years later',
    ],
    growth: [
      'Letting someone see the unedited version of you',
      'Voicing a concern early instead of carrying it silently',
      'Accepting help without feeling that you have failed',
    ],
    inRelationships:
      'You commit deeply and slowly, and you offer genuine understanding. The failure mode is the door slam: quietly absorbing something for months, then ending it in a way that reads as sudden to everyone except you.',
  },
  INFP: {
    nickname: 'The Mediator',
    tagline: 'There is a way things should be, and you can feel exactly how far the current version is from it.',
    overview: [
      'You run everything against an internal sense of what is right. This makes you hard to move on things that matter and surprisingly flexible on things that do not.',
      'That same standard turns inward. You hold yourself to a version of you that does not exist yet, and you are considerably harder on yourself than on anyone else.',
    ],
    strengths: [
      'You hold values that do not bend under pressure',
      'You can sit with someone in pain without trying to fix it',
      'You see individual people, never categories',
      'You express things other people feel but cannot articulate',
    ],
    growth: [
      'Letting something be good enough to exist',
      'Naming a conflict instead of retreating from it',
      'Extending to yourself the patience you give everyone else',
    ],
    inRelationships:
      'You love wholeheartedly and pay close attention. The friction comes from idealisation: you can build a picture of someone, then feel quietly betrayed when the real person turns out to be a person.',
  },
  INTJ: {
    // "The Architect", not "The Analyst": NT's group label is already "Analysts", so the
    // landing page rendered a section headed ANALYSTS with a card inside it reading "The
    // Analyst". Architect is the more widely recognised name for INTJ anyway.
    nickname: 'The Architect',
    tagline: 'You already thought this through, and you are waiting for everyone else to catch up.',
    overview: [
      'You build models. You want to understand how a system actually works, and once you do, its flaws are obvious to you and hard to unsee.',
      'Your confidence in your own reasoning is mostly earned, which is what makes it dangerous. You will discount an objection because the person could not argue it well, when the objection itself was sound.',
    ],
    strengths: [
      'You see structural problems long before they surface',
      'You are genuinely independent in your thinking',
      'You plan across horizons most people do not consider',
      'You are willing to be unpopular for something you believe is correct',
    ],
    growth: [
      'Taking a badly argued objection seriously',
      'Explaining your reasoning instead of presenting the conclusion',
      'Accepting that emotional information is information',
    ],
    inRelationships:
      'You are loyal, honest, and you take commitment seriously. The gap is expression: you may feel a great deal and assume it is understood, when the other person needed to hear it out loud.',
  },
  INTP: {
    nickname: 'The Logician',
    tagline: 'You will happily spend three hours on a problem nobody asked you to solve.',
    overview: [
      'You want things to be internally consistent. An idea that almost works bothers you more than one that clearly does not, and you will keep turning it over long after the conversation moved on.',
      'The gap is between understanding and doing. You can hold a complete solution in your head and feel no particular urgency to build it, because the understanding was the part you wanted.',
    ],
    strengths: [
      'You find the flaw in reasoning that everyone else accepted',
      'You are honest about the limits of what you know',
      'You approach problems without inherited assumptions',
      'You explain complicated things clearly once you decide to',
    ],
    growth: [
      'Shipping something imperfect instead of refining it privately',
      'Saying the thought instead of assuming it was obvious',
      'Treating other people\'s feelings as real constraints, not noise',
    ],
    inRelationships:
      'You are genuinely interested in how someone thinks, which is its own form of attention. The difficulty is emotional bandwidth: you may go quiet exactly when someone needs you present, not because you do not care but because you are processing.',
  },
  ISFJ: {
    nickname: 'The Nurturer',
    tagline: 'You have quietly been holding this together for a while now.',
    overview: [
      'You take care of things without being asked and without announcing it. You remember what matters to people and you act on it, reliably, over years.',
      'Because you rarely make your contribution visible, it often is not. You can end up carrying far more than anyone realises, including you, until it becomes too much all at once.',
    ],
    strengths: [
      'You follow through, every time, without needing to be reminded',
      'You remember the details about people that make them feel known',
      'You are steady when the situation is not',
      'You give practical help rather than sympathy',
    ],
    growth: [
      'Saying what you need before you are past your limit',
      'Letting a change happen without bracing against it',
      'Accepting help without treating it as an imposition',
    ],
    inRelationships:
      'You are dependable in a way that becomes the foundation other people build on. Watch for the pattern of giving until you are depleted and then feeling unappreciated for a contribution you deliberately kept invisible.',
  },
  ISFP: {
    nickname: 'The Composer',
    tagline: 'You do not explain it much, but you know exactly how you want it to feel.',
    overview: [
      'You have strong aesthetic and moral instincts that you rarely argue for. You simply know what feels right, and you arrange your life around that rather than around a stated position.',
      'You are more private than people assume from your warmth. Conflict feels genuinely bad to you, so you tend to withdraw rather than press, and things go unsaid for a long time.',
    ],
    strengths: [
      'You notice beauty and detail that others walk past',
      'You accept people as they are without conditions',
      'You act on values rather than talking about them',
      'You stay present with someone who is struggling',
    ],
    growth: [
      'Saying a disagreement out loud while it is still small',
      'Planning far enough ahead for the thing you want to be possible',
      'Believing your own taste is worth defending in public',
    ],
    inRelationships:
      'You are attentive, accepting, and rarely make anyone feel judged. The recurring issue is voice: things that bother you can go unspoken until they have grown large enough to be hard to talk about at all.',
  },
  ISTJ: {
    nickname: 'The Inspector',
    tagline: 'If you said it would be done, it is done, and it is done properly.',
    overview: [
      'You are the person things can be relied on. You do what you said, to the standard you said, on the date you said, and you find it strange that this is considered remarkable.',
      'You trust what has been demonstrated. Untested enthusiasm does not move you, which protects you from most bad ideas and occasionally from a good one.',
    ],
    strengths: [
      'Your word is genuinely reliable',
      'You catch the error that everyone else scrolled past',
      'You stay steady under pressure that rattles other people',
      'You build things that hold up over time',
    ],
    growth: [
      'Giving an unproven approach a real chance',
      'Saying the appreciation you assume people already know',
      'Letting good enough be finished',
    ],
    inRelationships:
      'You show love through consistency and follow-through, which is a deeper form of it than most gestures. What is often missing is the spoken part: people close to you may need to hear the thing you consider obvious.',
  },
  ISTP: {
    nickname: 'The Craftsman',
    tagline: 'You took it apart to see how it worked, and now it works better.',
    overview: [
      'You understand things by handling them. Theory is fine, but you learn by doing, and you are unusually good at diagnosing what is actually wrong with something.',
      'You need autonomy more than most people, and you are willing to trade a lot for it. Being managed closely does not make you work better, it makes you leave.',
    ],
    strengths: [
      'You fix things other people declared broken',
      'You stay completely calm in an emergency',
      'You are efficient without needing to be told to be',
      'You say what you think without dressing it up',
    ],
    growth: [
      'Explaining your reasoning instead of just producing the result',
      'Staying with something after the interesting part is solved',
      'Recognising that a relationship needs maintenance, not just repair',
    ],
    inRelationships:
      'You are easy to be around and you help in concrete, useful ways. The friction is emotional conversation: you tend to solve or exit, and some things need neither, just your presence while they are difficult.',
  },
}
