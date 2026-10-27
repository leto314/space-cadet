import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { buildDailyLadder, createSession, dailyResult, DAILY_QUESTIONS, DAILY_SECONDS, DAILY_STAGES, OPS, POINTS_PER_QUESTION, sampleProblem } from "./logic";
import { ChoiceButton, ChoiceRow, GameSetupShell, SettingCard, TapePicker } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";

const ACCENT = SPACE_CADET.mentalMath;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function NumberPad({ onPress, onDelete, onSubmit, disabled, feedback }) {
  const submitLabel = feedback === "success" ? "CORRECT" : feedback === "error" ? "WRONG" : "ENTER";
  return <View style={styles.keypad}>{[1,2,3,4,5,6,7,8,9].map((number) => <TouchableOpacity key={number} activeOpacity={0.82} disabled={disabled} onPressIn={() => onPress(String(number))} style={styles.key}><Text style={styles.keyText}>{number}</Text></TouchableOpacity>)}<TouchableOpacity activeOpacity={0.82} disabled={disabled} onPressIn={onDelete} style={styles.key}><Text style={styles.keyAction}>DELETE</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.82} disabled={disabled} onPressIn={() => onPress("0")} style={styles.key}><Text style={styles.keyText}>0</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.82} disabled={disabled} onPressIn={onSubmit} style={[styles.key, styles.submitKey, feedback === "success" && styles.submitCorrect, feedback === "error" && styles.submitWrong]}><Text style={[styles.submitKeyText, feedback && styles.submitFeedbackText]}>{submitLabel}</Text></TouchableOpacity></View>;
}

function Expression({ value, style }) {
  return (
    <Text style={style}>
      {value.split(/([+\-×÷])/).map((part, index) => (
        <Text key={`${part}-${index}`} style={[style, /[+\-×÷]/.test(part) && styles.expressionOperator]}>{part}</Text>
      ))}
    </Text>
  );
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's ladder
// of 25 questions in 2 minutes, then onFinish({ score, metrics, trials }).
export function MentalMathGame({ onExit, daily = null }) {
  const [duration, setDuration] = useState(1); const [operations, setOperations] = useState(["+", "-"]); const [operationCount, setOperationCount] = useState(1); const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [remaining, setRemaining] = useState(daily ? DAILY_SECONDS : 60); const [problem, setProblem] = useState(null); const [readyProblem, setReadyProblem] = useState(() => daily ? buildDailyLadder(daily.seed)[0] : null); const [questionIndex, setQuestionIndex] = useState(0); const [answer, setAnswer] = useState(""); const [score, setScore] = useState(0); const [attempts, setAttempts] = useState(0); const [correctTimes, setCorrectTimes] = useState([]); const [feedback, setFeedback] = useState(null);
  const intervalRef = useRef(null); const timeouts = useRef([]); const problemStartedAt = useRef(0); const sessionRef = useRef(null); const ladderRef = useRef([]); const resultsRef = useRef([]); const finishedRef = useRef(false);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });
  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function resetToPreflight() { clearTimers(); setFeedback(null); setProblem(null); setAnswer(""); setPhase("preflight"); }
  function resetToReady() { clearTimers(); setFeedback(null); setProblem(null); setAnswer(""); setReadyProblem(sampleProblem({ operations, operationCount }, randomSeed())); setPhase("ready"); }
  function nextProblem(index) {
    let next;
    if (daily) { next = ladderRef.current[index]; if (!next) { finishGame(); return; } }
    else next = sessionRef.current.next();
    setQuestionIndex(index); setProblem(next); setAnswer(""); problemStartedAt.current = Date.now();
  }
  function finishGame() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearTimers();
    if (!daily) { setPhase("summary"); return; }
    daily.onFinish(dailyResult(resultsRef.current, ladderRef.current));
  }
  function startGame() {
    clearTimers(); finishedRef.current = false; resultsRef.current = [];
    if (daily) ladderRef.current = buildDailyLadder(daily.seed); else sessionRef.current = createSession({ operations, operationCount }, randomSeed());
    setScore(0); setAttempts(0); setCorrectTimes([]); setFeedback(null); setRemaining(daily ? DAILY_SECONDS : duration * 60); setPhase("playing"); nextProblem(0);
    intervalRef.current = setInterval(() => setRemaining((current) => { if (current <= 1) { finishGame(); return 0; } return current - 1; }), 1000);
  }
  async function submit() {
    if (!problem || !answer || feedback || finishedRef.current) return;
    const correct = Number(answer) === problem.answer; const responseTime = Date.now() - problemStartedAt.current;
    await triggerSelectionHaptic();
    resultsRef.current = [...resultsRef.current, { ok: correct ? 1 : 0, ms: responseTime, stage: problem.stage ?? null }];
    setAttempts((value) => value + 1); setFeedback(correct ? "success" : "error");
    if (correct) { setScore((value) => value + 1); setCorrectTimes((value) => [...value, responseTime]); }
    timeouts.current.push(setTimeout(() => { setFeedback(null); nextProblem(questionIndex + 1); }, 200));
  }
  function digit(value) { void triggerSelectionHaptic(); setAnswer((current) => `${current}${value}`.slice(0, 7)); }
  function erase() { void triggerSelectionHaptic(); setAnswer((current) => current.slice(0, -1)); }
  function toggle(operation) { setOperations((current) => current.includes(operation) ? (current.length === 1 ? current : current.filter((item) => item !== operation)) : [...current, operation]); }
  const average = correctTimes.length ? Math.round(correctTimes.reduce((sum, value) => sum + value, 0) / correctTimes.length) : null; const accuracy = attempts ? Math.round((score / attempts) * 100) : 0;
  const stage = daily && problem ? DAILY_STAGES[problem.stage] : null;
  const preflight = <GameSetupShell title="Flash Math" categoryKey="mentalMath" onExit={onExit} onStart={() => startMission(resetToReady)} rules="Tests mental calculation speed and accuracy. Solve each expression, then submit the result before time runs out. A wrong answer moves on to the next expression.Easy: Use one operation per expression.Medium: Combine up to two operations.Hard: Combine up to three operations, or select Random."><SettingCard label="Duration" hint="In minutes"><TapePicker options={[1,2,3,4,5].map((value) => ({ value, label: String(value) }))} value={duration} onChange={setDuration} /></SettingCard><SettingCard label="Operations" hint="Select one or more operations."><ChoiceRow>{OPS.map((operation) => <ChoiceButton key={operation.name} label={operation.label} selected={operations.includes(operation.value)} accent={ACCENT} onPress={() => toggle(operation.value)} />)}</ChoiceRow></SettingCard><SettingCard label="Operations per exercise"><TapePicker options={[{value:1,label:"1"},{value:2,label:"2"},{value:3,label:"3"},{value:"random",label:"RANDOM"}]} value={operationCount} onChange={setOperationCount} /></SettingCard></GameSetupShell>;
  return <View style={styles.container}>{phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}{phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}><View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({pressed}) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>{phase === "ready" ? <Pressable style={styles.readyScreen} onPress={startGame}><Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "MENTAL MATH"}</Text><Text style={styles.readyTitle}>Ready to calculate?</Text><Text style={styles.readyText}>{daily ? `${DAILY_QUESTIONS} questions in ${DAILY_STAGES.length} stages, harder as you go, ${formatTime(DAILY_SECONDS)} on the clock. ${Math.round(POINTS_PER_QUESTION)} points per right answer; a wrong one moves on.` : "Solve each expression as quickly and accurately as you can."}</Text><View style={styles.readyExpression}><Expression value={readyProblem?.expression ?? ""} style={styles.readyExpressionText} /></View><PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt></Pressable> : null}{phase === "playing" && problem ? <Animated.View entering={FadeIn.duration(160)} style={styles.playScreen}><View style={styles.statusRow}><View><Text style={styles.statusLabel}>TIME LEFT</Text><Text style={styles.statusValue}>{formatTime(remaining)}</Text></View><View style={styles.scoreBlock}><Text style={styles.statusLabel}>{daily ? "POINTS" : "SCORE"}</Text><Text style={styles.statusValue}>{daily ? Math.round(score * POINTS_PER_QUESTION) : score}</Text></View></View><View style={styles.problemArea}><Text style={styles.problemKicker}>{daily ? `QUESTION ${questionIndex + 1} / ${DAILY_QUESTIONS} · STAGE ${problem.stage + 1} · ${stage.label}` : "SOLVE THE EXPRESSION"}</Text><Expression value={problem.expression} style={styles.problemText} /><View style={[styles.answerBox, feedback === "success" && styles.answerSuccess, feedback === "error" && styles.answerError]}><Text style={[styles.answerText, feedback === "success" && styles.answerTextSuccess, feedback === "error" && styles.answerTextError]}>{answer}</Text></View></View><NumberPad disabled={Boolean(feedback)} onPress={digit} onDelete={erase} onSubmit={submit} feedback={feedback} /></Animated.View> : null}{phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>Time complete</Text><View style={styles.scoreSummaryRow}><Text style={styles.scoreNumber}>{score}</Text><Text style={styles.scoreUnit}>CORRECT</Text></View><View style={styles.resultCard}><Text style={styles.resultLine}>Answers submitted <Text style={styles.resultValue}>{attempts}</Text></Text><Text style={styles.resultLine}>Accuracy <Text style={styles.resultValue}>{accuracy}%</Text></Text><Text style={styles.resultLine}>Average correct response <Text style={styles.resultValue}>{average !== null ? `${average} ms` : "—"}</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={startGame} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}</Animated.View> : null}</View>;
}

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:SPACE_CADET.black},preflightLayer:{...StyleSheet.absoluteFill,zIndex:1},missionLayer:{flex:1,backgroundColor:SPACE_CADET.black,zIndex:2},header:{height:64,paddingHorizontal:20,justifyContent:"center"},backButton:{width:44,height:44,justifyContent:"center",alignItems:"center"},backArrow:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:32,lineHeight:36},pressed:{transform:[{scale:0.97}]},kicker:{color:ACCENT,fontFamily:"Gontserrat-SemiBold",fontSize:10,letterSpacing:1.9,textAlign:"center"},readyScreen:{flex:1,alignItems:"center",paddingHorizontal:28,paddingTop:64},readyTitle:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:31,marginTop:9,textAlign:"center"},readyText:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-Regular",fontSize:14,lineHeight:21,maxWidth:296,textAlign:"center",marginTop:12},readyExpression:{minWidth:210,borderRadius:22,paddingVertical:25,paddingHorizontal:30,alignItems:"center",backgroundColor:SPACE_CADET.surface1,marginTop:40},readyExpressionText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:31},expressionOperator:{color:ACCENT},beginPrompt:{marginTop:48,textAlign:"center"},playScreen:{flex:1,paddingHorizontal:20,paddingBottom:24},statusRow:{flexDirection:"row",justifyContent:"space-between",marginTop:16},scoreBlock:{alignItems:"flex-end"},statusLabel:{color:SPACE_CADET.textTertiary,fontFamily:"Gontserrat-SemiBold",fontSize:9,letterSpacing:1.5},statusValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:28,marginTop:3},problemArea:{flex:1,alignItems:"center",justifyContent:"center",paddingBottom:20},problemKicker:{color:ACCENT,fontFamily:"Gontserrat-SemiBold",fontSize:10,letterSpacing:1.7,marginBottom:17,textAlign:"center"},problemText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:46,lineHeight:58,textAlign:"center",width:"100%"},answerBox:{minWidth:176,height:62,borderBottomWidth:1.5,borderBottomColor:SPACE_CADET.borderStrong,justifyContent:"center",alignItems:"center",marginTop:26},answerSuccess:{borderBottomColor:SUCCESS},answerError:{borderBottomColor:ERROR},answerText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:34,lineHeight:40,minWidth:30,textAlign:"center"},answerTextSuccess:{color:SUCCESS,textShadowColor:SUCCESS,textShadowRadius:14,textShadowOffset:{width:0,height:0}},answerTextError:{color:ERROR,textShadowColor:ERROR,textShadowRadius:14,textShadowOffset:{width:0,height:0}},keypad:{flexDirection:"row",flexWrap:"wrap",gap:9},key:{width:"31.3%",height:57,borderRadius:17,alignItems:"center",justifyContent:"center",backgroundColor:SPACE_CADET.surface1},keyText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:24},keyAction:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-SemiBold",fontSize:9,letterSpacing:0.8},submitKey:{backgroundColor:SPACE_CADET.white},submitKeyText:{color:SPACE_CADET.black,fontFamily:"Gontserrat-SemiBold",fontSize:10,letterSpacing:1.1},submitCorrect:{backgroundColor:SUCCESS},submitWrong:{backgroundColor:ERROR},submitFeedbackText:{color:SPACE_CADET.white},summaryScreen:{flex:1,alignItems:"center",paddingHorizontal:20,paddingTop:70,paddingBottom:28},summaryTitle:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:31,marginTop:8},scoreSummaryRow:{flexDirection:"row",alignItems:"center",gap:10,marginTop:31,marginBottom:26},scoreNumber:{color:ACCENT,fontFamily:"Garet-Book",fontSize:53},scoreUnit:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-SemiBold",fontSize:11,letterSpacing:1.7},resultCard:{width:"100%",backgroundColor:SPACE_CADET.surface1,borderRadius:22,padding:19},resultLine:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-Regular",fontSize:13,lineHeight:25},resultValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:15},actions:{width:"100%",gap:12,marginTop:"auto"},primaryButton:{minHeight:54,borderRadius:999,alignItems:"center",justifyContent:"center",backgroundColor:SPACE_CADET.white},primaryText:{color:SPACE_CADET.black,fontFamily:"Gontserrat-Regular",fontSize:16,lineHeight:20,transform:[{translateY:2}]},secondaryButton:{minHeight:52,borderRadius:999,borderWidth:1,borderColor:SPACE_CADET.borderDefault,alignItems:"center",justifyContent:"center"},secondaryText:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Regular",fontSize:15,lineHeight:19,transform:[{translateY:2}]}
});
