// "איך מגיעים לכאן ולאן ממשיכים" — הקריאה של הזרימה, לא העריכה שלה.
//
// שלושת המנגנונים (showIf, next, onSubmit) יושבים בשלושה שדות נפרדים, וכל אחד
// מהם נכון בפני עצמו ולא אומר כלום על הסדר בפועל. הפאנל הזה מחשב את התשובה
// מהקונפיג המלא ומציג אותה במשפטים — כולל המעבר הנפוץ ביותר, "פשוט המסך הבא",
// שאין לו שום ייצוג בעורך כי הוא היעדר של כלל.

import type { Screen, SurveyConfig } from '../engine/types';
import type { Naming } from './display';
import {
  conditionSentence,
  conditionVars,
  optionalConditionSentence,
  screenLabel,
  varLabel,
  varValueLabel,
} from './display';
import { fallThroughSources, fallThroughTargets } from './reachability';
import { ArrowIcon, BranchIcon, EyeIcon, VarIcon } from './Icons';

interface Props {
  config: SurveyConfig;
  screen: Screen;
  naming: Naming;
  onSelect: (id: string) => void;
}

export function FlowContext({ config, screen, naming, onSelect }: Props) {
  const screens = config.screens;
  const index = screens.findIndex((s) => s.id === screen.id);

  const jumpsIn = screens.flatMap((s) =>
    (s.next ?? [])
      .map((rule, i) => ({ from: s, rule, i }))
      .filter(({ rule }) => rule.goto === screen.id),
  );
  // אותו חישוב שמזין את הקשתות בתרשים — כדי שהפאנל והתרשים לא יוכלו לספר
  // שני סיפורים שונים, וכדי שלא יימנו כאן מעברים שאינם אפשריים
  const fallIn = fallThroughSources(screens, index);
  const fallOut = fallThroughTargets(screens, index);

  // הסימונים שתנאי התצוגה של המסך נשען עליהם, ואיפה הם נקבעים בפועל
  const dependsOn = screen.showIf ? [...new Set(conditionVars(screen.showIf))] : [];
  const setHere = screen.onSubmit ?? [];
  const readers = setHere.length > 0 ? screensReading(screens, setHere.map((r) => r.var)) : [];

  return (
    <section className="flow-context">
      <h3 className="flow-context-title">איך מגיעים לכאן, ולאן ממשיכים</h3>

      {index === 0 && <p className="flow-line">זהו המסך הראשון — כל משיב מתחיל כאן.</p>}

      {jumpsIn.map(({ from, rule, i }) => (
        <p className="flow-line" key={`${from.id}-${i}`}>
          <BranchIcon width={13} height={13} />
          <span>
            קפיצה מ<Ref naming={naming} id={from.id} onSelect={onSelect} /> — {optionalConditionSentence(naming, rule.if)}
          </span>
        </p>
      ))}

      {fallIn.map((s, i) => (
        <p className="flow-line" key={s.id}>
          <ArrowIcon width={13} height={13} />
          <span>
            ברצף, אחרי <Ref naming={naming} id={s.id} onSelect={onSelect} />
            {i > 0 && ' (כשהמסכים שביניהם מדולגים)'}
          </span>
        </p>
      ))}

      {index > 0 && jumpsIn.length === 0 && fallIn.length === 0 && (
        <p className="flow-line warn">אף מסך לא מוביל לכאן — המסך הזה לא ייראה לאף משיב.</p>
      )}

      <p className="flow-line strong">
        <EyeIcon width={13} height={13} />
        <span>
          {screen.showIf
            ? `מוצג רק כאשר: ${conditionSentence(naming, screen.showIf)}`
            : 'מוצג לכל מי שמגיע לכאן'}
        </span>
      </p>

      {dependsOn.map((v) => {
        const source = screens.find((s) => (s.onSubmit ?? []).some((r) => r.var === v));
        const sourceIndex = source ? screens.indexOf(source) : -1;
        if (!source) {
          return (
            <p className="flow-line warn" key={v}>
              ״{varLabel(naming, v)}״ לא נקבע באף מסך — התנאי לעולם לא יתקיים.
            </p>
          );
        }
        return (
          <p className={`flow-line${sourceIndex > index ? ' warn' : ''}`} key={v}>
            <VarIcon width={13} height={13} />
            <span>
              ״{varLabel(naming, v)}״ נקבע ב<Ref naming={naming} id={source.id} onSelect={onSelect} />
              {sourceIndex > index && ' — שיושב אחרי המסך הזה, ולכן הסימון עדיין ריק כאן'}
            </span>
          </p>
        );
      })}

      {screen.type === 'end' ? (
        <p className="flow-line strong">כאן השאלון נגמר.</p>
      ) : (
        <>
          {(screen.next ?? []).map((rule, i) => (
            <p className="flow-line" key={i}>
              <BranchIcon width={13} height={13} />
              <span>
                {rule.if ? conditionSentence(naming, rule.if) : 'תמיד'} ← קפיצה אל{' '}
                <Ref naming={naming} id={rule.goto} onSelect={onSelect} />
              </span>
            </p>
          ))}
          {fallOut.map((s, i) => (
            <p className="flow-line" key={s.id}>
              <ArrowIcon width={13} height={13} />
              <span>
                {i === 0 ? 'אחר כך: ' : 'אם הוא מדולג: '}
                <Ref naming={naming} id={s.id} onSelect={onSelect} />
                {s.showIf && ` — רק אם ${conditionSentence(naming, s.showIf)}`}
              </span>
            </p>
          ))}
          {fallOut.length === 0 && (screen.next ?? []).length === 0 && (
            <p className="flow-line warn">אין המשך — זה המסך האחרון, והמשיב ייתקע בלי מסך סיום.</p>
          )}
        </>
      )}

      {setHere.map((rule, i) => (
        <p className="flow-line" key={i}>
          <VarIcon width={13} height={13} />
          <span>
            כאן נקבע: ״{varLabel(naming, rule.var)}״ = {varValueLabel(naming, rule.var, rule.value)}
            {rule.if && ` — כאשר ${conditionSentence(naming, rule.if)}`}
          </span>
        </p>
      ))}

      {readers.length > 0 && (
        <p className="flow-line muted">
          תלויים בסימון הזה: {readers.length} מסכים
          {readers.some((s) => screens.indexOf(s) < index) && ' — חלקם לפני המסך הזה, ושם הסימון עוד ריק'}
        </p>
      )}
    </section>
  );
}

/** מסכים שתנאי התצוגה או הניתוב שלהם קוראים אחד מהסימונים האלה. */
function screensReading(screens: Screen[], vars: string[]): Screen[] {
  const wanted = new Set(vars);
  return screens.filter((s) => {
    const conds = [s.showIf, ...(s.next ?? []).map((r) => r.if), ...(s.onSubmit ?? []).map((r) => r.if)];
    return conds.some((c) => c && conditionVars(c).some((v) => wanted.has(v)));
  });
}

function Ref({ naming, id, onSelect }: { naming: Naming; id: string; onSelect: (id: string) => void }) {
  const screen = naming.screens.find((s) => s.id === id);
  if (!screen) return <span className="flow-ref missing">״{id}״ (מסך שנמחק)</span>;
  return (
    <button className="flow-ref" onClick={() => onSelect(id)} title={id}>
      {naming.screens.indexOf(screen) + 1} · {screenLabel(screen)}
    </button>
  );
}
