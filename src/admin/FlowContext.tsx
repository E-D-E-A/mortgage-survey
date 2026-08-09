// "המקום בזרימה" — הקריאה של הזרימה, לא העריכה שלה.
//
// שלושת המנגנונים (showIf, next, onSubmit) יושבים בשלושה שדות נפרדים, וכל אחד
// מהם נכון בפני עצמו ולא אומר כלום על הסדר בפועל. הפאנל הזה מחשב את התשובה
// מהקונפיג המלא ומציג אותה בארבע קבוצות קבועות, כל אחת עונה על שאלה אחת:
// מגיעים לכאן · מוצג רק כאשר · ממשיכים מכאן · נקבע כאן.
//
// שני כללי ניסוח הופכים את זה לקריא:
// 1. תנאי שמפנה למסך הזה עצמו נכתב "התשובה כאן", לא ציטוט השאלה לעצמה.
// 2. זוג כללים משלימים (תנאי + השלילה שלו, כמו שמציב את segment) מוצג
//    כ"אחרת ←", לא כמשפט השלילה המלא.

import type { Condition, Screen, SetVarRule, SurveyConfig } from '../engine/types';
import type { Naming } from './display';
import {
  conditionSentence,
  conditionVars,
  screenLabel,
  varLabel,
  varValueLabel,
} from './display';
import { fallThroughSources, fallThroughTargets } from './reachability';
import { ArrowIcon, BranchIcon, VarIcon } from './Icons';

interface Props {
  config: SurveyConfig;
  screen: Screen;
  naming: Naming;
  onSelect: (id: string) => void;
}

/** כלל שתנאו הוא בדיוק השלילה של קודמו, על אותו סימון — מוצג כ"אחרת". */
function isOtherwise(prev: SetVarRule, rule: SetVarRule): boolean {
  if (prev.var !== rule.var || !prev.if || !rule.if) return false;
  const negated = rule.if as { not?: Condition };
  return negated.not !== undefined && JSON.stringify(negated.not) === JSON.stringify(prev.if);
}

export function FlowContext({ config, screen, naming, onSelect }: Props) {
  const screens = config.screens;
  const index = screens.findIndex((s) => s.id === screen.id);
  const here = { selfId: screen.id };

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

  const jumpsOut = screen.next ?? [];

  return (
    <section className="flow-context">
      <h3 className="flow-context-title">המקום בזרימה</h3>

      <div className="flow-group">
        <h4 className="flow-group-title">מגיעים לכאן</h4>
        {index === 0 && <p className="flow-line">כל משיב מתחיל כאן — זה המסך הראשון.</p>}
        {fallIn.map((s, i) => (
          <p className="flow-line" key={s.id}>
            <ArrowIcon width={13} height={13} />
            <span>
              {i === 0 ? 'בא אחרי ' : 'או, אם דילגו על אותו מסך: אחרי '}
              <Ref naming={naming} id={s.id} onSelect={onSelect} />
            </span>
          </p>
        ))}
        {jumpsIn.map(({ from, rule, i }) => (
          <p className="flow-line" key={`${from.id}-${i}`}>
            <BranchIcon width={13} height={13} />
            <span>
              בקפיצה מ<Ref naming={naming} id={from.id} onSelect={onSelect} />
              {rule.if &&
                ` — אם ${conditionSentence(naming, rule.if, false, { selfId: from.id, selfText: 'התשובה שם' })}`}
            </span>
          </p>
        ))}
        {index > 0 && jumpsIn.length === 0 && fallIn.length === 0 && (
          <p className="flow-line warn">אף מסך לא מוביל לכאן, ולכן אף משיב לא יראה את המסך הזה.</p>
        )}
      </div>

      {screen.showIf && (
        <div className="flow-group">
          <h4 className="flow-group-title">מוצג רק כאשר</h4>
          <p className="flow-line">{conditionSentence(naming, screen.showIf, false, here)}</p>
          {dependsOn.map((v) => {
            const source = screens.find((s) => (s.onSubmit ?? []).some((r) => r.var === v));
            const sourceIndex = source ? screens.indexOf(source) : -1;
            if (!source) {
              return (
                <p className="flow-line warn" key={v}>
                  אף מסך לא קובע את ״{varLabel(naming, v)}״, ולכן התנאי הזה לעולם לא יתקיים.
                </p>
              );
            }
            return (
              <p className={`flow-line muted${sourceIndex > index ? ' warn' : ''}`} key={v}>
                <VarIcon width={13} height={13} />
                <span>
                  ״{varLabel(naming, v)}״ נקבע ב<Ref naming={naming} id={source.id} onSelect={onSelect} />
                  {sourceIndex > index && ' — שבא אחרי המסך הזה, ולכן הסימון עדיין ריק כאן'}
                </span>
              </p>
            );
          })}
        </div>
      )}

      <div className="flow-group">
        <h4 className="flow-group-title">ממשיכים מכאן</h4>
        {screen.type === 'end' ? (
          <p className="flow-line">כאן השאלון נגמר.</p>
        ) : (
          <>
            {jumpsOut.map((rule, i) => (
              <p className="flow-line" key={i}>
                <BranchIcon width={13} height={13} />
                <span>
                  {rule.if
                    ? `אם ${conditionSentence(naming, rule.if, false, here)} — `
                    : 'תמיד — '}
                  קפיצה אל <Ref naming={naming} id={rule.goto} onSelect={onSelect} />
                </span>
              </p>
            ))}
            {fallOut.length === 1 && !fallOut[0].showIf ? (
              <p className="flow-line">
                <ArrowIcon width={13} height={13} />
                <span>
                  {jumpsOut.length > 0 ? 'אחרת — אל ' : 'אל '}
                  <Ref naming={naming} id={fallOut[0].id} onSelect={onSelect} />
                </span>
              </p>
            ) : fallOut.length > 0 ? (
              <>
                <p className="flow-line muted">
                  {jumpsOut.length > 0
                    ? 'אחרת — אל הראשון מבין אלה שמתאים למשיב:'
                    : 'אל הראשון מבין אלה שמתאים למשיב:'}
                </p>
                <ol className="flow-cascade">
                  {fallOut.map((s) => (
                    <li key={s.id}>
                      <Ref naming={naming} id={s.id} onSelect={onSelect} />
                      {s.showIf
                        ? ` — אם ${conditionSentence(naming, s.showIf, false, here)}`
                        : ' — תמיד'}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            {fallOut.length === 0 && jumpsOut.length === 0 && (
              <p className="flow-line warn">אין מכאן המשך — המשיב ייתקע כאן בלי להגיע למסך סיום.</p>
            )}
          </>
        )}
      </div>

      {setHere.length > 0 && (
        <div className="flow-group">
          <h4 className="flow-group-title">נקבע כאן</h4>
          {setHere.map((rule, i) => {
            const prev = setHere[i - 1];
            const otherwise = prev !== undefined && isOtherwise(prev, rule);
            return (
              <p className="flow-line" key={i}>
                <VarIcon width={13} height={13} />
                <span>
                  {otherwise ? (
                    <>אחרת — ״{varLabel(naming, rule.var)}״ = ״{varValueLabel(naming, rule.var, rule.value)}״</>
                  ) : (
                    <>
                      ״{varLabel(naming, rule.var)}״ = ״{varValueLabel(naming, rule.var, rule.value)}״
                      {rule.if && ` — אם ${conditionSentence(naming, rule.if, false, here)}`}
                    </>
                  )}
                </span>
              </p>
            );
          })}
          {readers.length > 0 && (
            <p className="flow-line muted">
              {readers.length === 1 ? 'מסך אחד בהמשך נשען' : `${readers.length} מסכים בהמשך נשענים`}{' '}
              על הסימון הזה
              {readers.some((s) => screens.indexOf(s) < index) &&
                ' — וגם מסכים שבאים לפניו, ושם הוא עדיין ריק'}
            </p>
          )}
        </div>
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
  if (!screen) return <span className="flow-ref missing">״{id}״ — מסך שנמחק</span>;
  return (
    <button className="flow-ref" onClick={() => onSelect(id)} title={id}>
      {naming.screens.indexOf(screen) + 1} · {screenLabel(screen)}
    </button>
  );
}
