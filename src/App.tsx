// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { Crosshair, Radar, Navigation, Eye, EyeOff, Copy, Check, Users, UserCheck, AlertTriangle, RotateCcw, Terminal, Briefcase, HelpCircle } from 'lucide-react';

const firebaseConfig = {
  apiKey: "AIzaSyBQZtzey2ieGFMxhi8K2eqffRHeH4LEitI",
  authDomain: "codename-shadow.firebaseapp.com",
  databaseURL: "https://codename-shadow-default-rtdb.firebaseio.com",
  projectId: "codename-shadow",
  storageBucket: "codename-shadow.firebasestorage.app",
  messagingSenderId: "965357760102",
  appId: "1:965357760102:web:7cf015ad41b12b119587a7",
  measurementId: "G-PPBF2G0HEZ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const COLS = ['A', 'B', 'C', 'D', 'E'];
const ROWS = [1, 2, 3, 4, 5];
const coordToString = (r, c) => `${COLS[c]}${ROWS[r]}`;
const isAdjacent = (p1, p2) => p1 && p2 && Math.abs(p1.r - p2.r) + Math.abs(p1.c - p2.c) === 1;
const isWithinTwo = (p1, p2) => p1 && p2 && Math.abs(p1.r - p2.r) <= 2 && Math.abs(p1.c - p2.c) <= 2;
const isWithinScanArea = (center, target) => center && target && Math.abs(center.r - target.r) <= 1 && Math.abs(center.c - target.c) <= 1;
const getDirectionLabel = (from, to) => to.r < from.r ? '北 (↑)' : to.r > from.r ? '南 (↓)' : to.c > from.c ? '東 (→)' : to.c < from.c ? '西 (←)' : '';

export default function App() {
  const [mode, setMode] = useState('lobby');
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [playerRole, setPlayerRole] = useState(null);
  const [soloActiveView, setSoloActiveView] = useState('p1');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [gameState, setGameState] = useState({
    status: 'waiting',
    turn: 'p1',
    winner: null,
    winReason: '',
    p1: { agent: null, data: null, ready: false },
    p2: { agent: null, data: null, ready: false },
    logs: [],
    scans: []
  });

  const [setupStep, setSetupStep] = useState('agent');
  const [tempAgent, setTempAgent] = useState(null);
  const [tempData, setTempData] = useState(null);
  const [actionMode, setActionMode] = useState('move');
  const [selectedMemoMark, setSelectedMemoMark] = useState('×');
  const [memos, setMemos] = useState({ p1: {}, p2: {} });
  const [hideSecret, setHideSecret] = useState(false);

  const currentRole = mode === 'solo' ? soloActiveView : playerRole;
  const opponentRole = currentRole === 'p1' ? 'p2' : 'p1';

  useEffect(() => {
    if (mode !== 'online' || !roomId) return;
    const roomRef = doc(db, 'codename_shadow_rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) setGameState(docSnap.data());
      else setErrorMsg('ルームが見つかりません。');
    });
    return () => unsubscribe();
  }, [mode, roomId]);

  const createOnlineRoom = async () => {
    setErrorMsg('');
    const newId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const initialState = {
      status: 'waiting',
      turn: 'p1',
      winner: null,
      winReason: '',
      p1: { agent: null, data: null, ready: false },
      p2: { agent: null, data: null, ready: false },
      logs: [{ text: 'ルームが作成されました。対戦相手の参加を待っています...', type: 'system' }],
      scans: []
    };
    try {
      await setDoc(doc(db, 'codename_shadow_rooms', newId), initialState);
      setRoomId(newId);
      setPlayerRole('p1');
      setGameState(initialState);
      setMode('online');
      resetLocalSetup();
    } catch (e) {
      setErrorMsg('通信エラー：Firestoreの「テストモード」設定を確認してください。');
    }
  };

  const joinOnlineRoom = async () => {
    setErrorMsg('');
    const targetId = inputRoomId.trim().toUpperCase();
    if (!targetId) return;
    try {
      const roomRef = doc(db, 'codename_shadow_rooms', targetId);
      const snap = await getDoc(roomRef);
      if (!snap.exists()) {
        setErrorMsg('指定されたルームIDが存在しません。');
        return;
      }
      const data = snap.data();
      if (data.status === 'waiting') {
        await updateDoc(roomRef, {
          status: 'setup',
          logs: [...data.logs, { text: 'プレイヤー2が参加しました！初期配置を行ってください。', type: 'system' }]
        });
      }
      setRoomId(targetId);
      setPlayerRole('p2');
      setMode('online');
      resetLocalSetup();
    } catch (e) {
      setErrorMsg('ルームへの参加に失敗しました。');
    }
  };

  const startSoloMode = () => {
    setMode('solo');
    setSoloActiveView('p1');
    setGameState({
      status: 'setup',
      turn: 'p1',
      winner: null,
      winReason: '',
      p1: { agent: null, data: null, ready: false },
      p2: { agent: null, data: null, ready: false },
      logs: [{ text: 'ソロテストモード開始。P1とP2を切り替えて配置してください。', type: 'system' }],
      scans: []
    });
    setMemos({ p1: {}, p2: {} });
    resetLocalSetup();
  };

  const resetLocalSetup = () => {
    setSetupStep('agent');
    setTempAgent(null);
    setTempData(null);
    setActionMode('move');
  };

  const syncState = async (nextState) => {
    setGameState(nextState);
    if (mode === 'online' && roomId) {
      await updateDoc(doc(db, 'codename_shadow_rooms', roomId), nextState);
    }
  };

  const confirmSetup = async () => {
    if (!tempAgent || !tempData) return;
    const updatedPlayer = { agent: tempAgent, data: tempData, ready: true };
    const nextState = {
      ...gameState,
      [currentRole]: updatedPlayer,
      logs: [...gameState.logs, { text: `${currentRole === 'p1' ? 'プレイヤー1' : 'プレイヤー2'}が初期配置を完了しました。`, type: 'system' }]
    };
    if (nextState.p1.ready && nextState.p2.ready) {
      nextState.status = 'playing';
      nextState.logs.push({ text: '作戦開始！プレイヤー1のターンです。', type: 'system' });
    }
    await syncState(nextState);
    resetLocalSetup();
    if (mode === 'solo' && !nextState.p2.ready) setSoloActiveView('p2');
  };

  const handleCellClick = async (r, c) => {
    const key = `${r}-${c}`;
    if (gameState.status === 'playing' && actionMode === 'memo') {
      setMemos((prev) => {
        const currentMemos = { ...prev[currentRole] };
        if (currentMemos[key] === selectedMemoMark) delete currentMemos[key];
        else currentMemos[key] = selectedMemoMark;
        return { ...prev, [currentRole]: currentMemos };
      });
      return;
    }

    if (gameState.status === 'setup' && !gameState[currentRole].ready) {
      if (setupStep === 'agent') {
        if (tempData && tempData.r === r && tempData.c === c) return;
        setTempAgent({ r, c });
        setSetupStep('data');
      } else {
        if (tempAgent && tempAgent.r === r && tempAgent.c === c) return;
        setTempData({ r, c });
      }
      return;
    }

    if (gameState.status !== 'playing' || gameState.turn !== currentRole) return;

    const myState = gameState[currentRole];
    const oppState = gameState[opponentRole];
    const actorLabel = currentRole === 'p1' ? 'P1' : 'P2';

    if (actionMode === 'move') {
      if (!isAdjacent(myState.agent, { r, c })) return;
      if (myState.data.r === r && myState.data.c === c) {
        setErrorMsg('自分の機密データと同じマスには移動できません。');
        setTimeout(() => setErrorMsg(''), 2500);
        return;
      }
      const dir = getDirectionLabel(myState.agent, { r, c });
      await syncState({
        ...gameState,
        turn: opponentRole,
        [currentRole]: { ...myState, agent: { r, c } },
        logs: [...gameState.logs, { text: `[${actorLabel}] エージェントが ${dir} に移動しました。`, type: 'move' }]
      });
    }

    if (actionMode === 'scan') {
      if (!isWithinTwo(myState.agent, { r, c })) return;
      const center = { r, c };
      const hit = isWithinScanArea(center, oppState.agent) || isWithinScanArea(center, oppState.data);
      const coordStr = coordToString(r, c);
      await syncState({
        ...gameState,
        turn: opponentRole,
        scans: [...gameState.scans, { by: currentRole, center, hit }],
        logs: [...gameState.logs, { text: `[${actorLabel}] ${coordStr} 周辺をスキャン → ${hit ? '【反応あり！】' : '反応なし'}`, type: hit ? 'scan-hit' : 'scan-miss' }]
      });
    }

    if (actionMode === 'snipe') {
      const coordStr = coordToString(r, c);
      if (oppState.data.r === r && oppState.data.c === c) {
        await syncState({
          ...gameState,
          status: 'finished',
          winner: currentRole,
          winReason: `${coordStr} の機密データを正確に狙撃！`,
          logs: [...gameState.logs, { text: `🎯 [${actorLabel}] ${coordStr} を狙撃！機密データを破壊し勝利しました！`, type: 'win' }]
        });
      } else {
        const hitAgent = oppState.agent.r === r && oppState.agent.c === c;
        await syncState({
          ...gameState,
          turn: opponentRole,
          logs: [...gameState.logs, {
            text: hitAgent ? `💥 [${actorLabel}] ${coordStr} を狙撃！敵エージェントにかすったが、機密データではない！` : `💨 [${actorLabel}] ${coordStr} を狙撃したがハズレ...`,
            type: 'snipe-miss'
          }]
        });
      }
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (mode === 'lobby') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mb-2">
              <Radar className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-wider text-white">CODENAME: SHADOW</h1>
            <p className="text-xs text-slate-400">非公開型・論理推理タクティカルバトル（2人専用）</p>
          </div>

          {errorMsg && (
            <div className="bg-rose-950/60 border border-rose-500/50 text-rose-200 text-xs p-3 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-4">
            <button onClick={createOnlineRoom} className="w-full py-3.5 px-4 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-cyan-950">
              <Users className="w-5 h-5" />
              オンライン対戦ルームを作成
            </button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="flex-shrink mx-3 text-xs text-slate-500">または招待コードで参加</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="ルームID (例: A7X9K)"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value.toUpperCase())}
                maxLength={6}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm tracking-widest uppercase focus:outline-none focus:border-cyan-500"
              />
              <button onClick={joinOnlineRoom} className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold rounded-xl border border-slate-700 transition text-sm">
                参加
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800">
            <button onClick={startSoloMode} className="w-full py-2.5 px-4 bg-slate-800/60 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-xl border border-slate-700/70 transition flex items-center justify-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              ソロテストモード（1人2役でルール確認）
            </button>
          </div>
        </div>
      </div>
    );
  }

  const myState = gameState[currentRole];
  const oppState = gameState[opponentRole];
  const isMyTurn = gameState.status === 'playing' && gameState.turn === currentRole;
  const activeAgent = gameState.status === 'setup' && !myState.ready ? tempAgent : myState.agent;
  const activeData = gameState.status === 'setup' && !myState.ready ? tempData : myState.data;
  const myMemos = memos[currentRole] || {};

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-3 md:p-6 font-sans">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Radar className="w-5 h-5 text-cyan-400" />
            <div>
              <h1 className="text-sm font-bold tracking-wider text-white">CODENAME: SHADOW</h1>
              <div className="text-[11px] text-slate-400">
                あなたは <span className="text-cyan-400 font-bold">{currentRole === 'p1' ? 'プレイヤー1 (先攻)' : 'プレイヤー2 (後攻)'}</span>
              </div>
            </div>
          </div>

          {mode === 'online' ? (
            <button onClick={copyRoomId} className="flex items-center gap-2 bg-slate-950 border border-slate-700 px-3 py-1.5 rounded-lg text-xs hover:border-cyan-500 transition">
              <span className="text-slate-400">ID:</span>
              <span className="font-mono font-bold text-cyan-400 tracking-wider">{roomId}</span>
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            </button>
          ) : (
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button onClick={() => setSoloActiveView('p1')} className={`px-2.5 py-1 rounded text-xs font-medium transition ${soloActiveView === 'p1' ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>
                P1視点
              </button>
              <button onClick={() => setSoloActiveView('p2')} className={`px-2.5 py-1 rounded text-xs font-medium transition ${soloActiveView === 'p2' ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>
                P2視点
              </button>
            </div>
          )}
        </div>

        <div className={`rounded-xl p-3 border text-center text-sm font-semibold transition ${
          gameState.status === 'finished' ? 'bg-amber-950/60 border-amber-500 text-amber-200'
            : gameState.status === 'waiting' ? 'bg-slate-900 border-slate-700 text-slate-300'
            : gameState.status === 'setup' ? 'bg-indigo-950/60 border-indigo-500/50 text-indigo-200'
            : isMyTurn ? 'bg-cyan-950/70 border-cyan-500 text-cyan-200'
            : 'bg-slate-900 border-slate-800 text-slate-400'
        }`}>
          {gameState.status === 'waiting' && '対戦相手の参加を待っています...（ルームIDを共有してください）'}
          {gameState.status === 'setup' && (!myState.ready
            ? setupStep === 'agent' ? '【準備】自分の「エージェント（移動コマ）」の初期位置をタップしてください' : '【準備】守るべき「機密データ（固定）」の位置をタップしてください'
            : '相手の初期配置完了を待っています...')}
          {gameState.status === 'playing' && (isMyTurn ? '⚡ あなたのターンです！行動を選択してください' : '⏳ 相手プレイヤーが思考中です（メモ機能は使用可能）')}
          {gameState.status === 'finished' && `🏆 ${gameState.winner === 'p1' ? 'プレイヤー1' : 'プレイヤー2'} の勝利！（${gameState.winReason}）`}
        </div>

        {errorMsg && (
          <div className="bg-rose-950/80 border border-rose-500 text-rose-200 text-xs p-2.5 rounded-lg text-center">{errorMsg}</div>
        )}

        {gameState.status === 'setup' && !myState.ready && (
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-3 rounded-xl">
            <div className="text-xs space-y-1">
              <div>エージェント: <span className="font-mono text-cyan-400 font-bold">{tempAgent ? coordToString(tempAgent.r, tempAgent.c) : '未選択'}</span></div>
              <div>機密データ: <span className="font-mono text-amber-400 font-bold">{tempData ? coordToString(tempData.r, tempData.c) : '未選択'}</span></div>
            </div>
            <div className="flex gap-2">
              <button onClick={resetLocalSetup} className="px-3 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs hover:bg-slate-700">やり直す</button>
              <button disabled={!tempAgent || !tempData} onClick={confirmSetup} className="px-4 py-2 bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold rounded-lg text-xs">配置を確定</button>
            </div>
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs text-slate-400 font-mono">TACTICAL GRID 5x5</span>
            <button onClick={() => setHideSecret(!hideSecret)} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
              {hideSecret ? <EyeOff className="w-3.5 h-3.5 text-rose-400" /> : <Eye className="w-3.5 h-3.5 text-cyan-400" />}
              {hideSecret ? '自軍位置を非表示中' : 'のぞき見防止（自軍隠す）'}
            </button>
          </div>

          <div className="grid grid-cols-6 gap-1.5 max-w-sm mx-auto select-none">
            <div></div>
            {COLS.map((col) => <div key={col} className="text-center text-xs font-mono font-bold text-slate-500 py-1">{col}</div>)}

            {ROWS.map((row, rIdx) => (
              <React.Fragment key={row}>
                <div className="flex items-center justify-center text-xs font-mono font-bold text-slate-500">{row}</div>
                {COLS.map((col, cIdx) => {
                  const key = `${rIdx}-${cIdx}`;
                  const isMyAgent = !hideSecret && activeAgent?.r === rIdx && activeAgent?.c === cIdx;
                  const isMyData = !hideSecret && activeData?.r === rIdx && activeData?.c === cIdx;
                  const isOppAgent = gameState.status === 'finished' && oppState?.agent?.r === rIdx && oppState?.agent?.c === cIdx;
                  const isOppData = gameState.status === 'finished' && oppState?.data?.r === rIdx && oppState?.data?.c === cIdx;
                  const memoMark = myMemos[key];

                  let highlightClass = 'bg-slate-950 border-slate-800 hover:border-slate-600';
                  if (isMyTurn) {
                    if (actionMode === 'move' && isAdjacent(myState.agent, { r: rIdx, c: cIdx }) && !(myState.data.r === rIdx && myState.data.c === cIdx)) {
                      highlightClass = 'bg-cyan-950/50 border-cyan-500/70 hover:bg-cyan-900/60 cursor-pointer';
                    } else if (actionMode === 'scan' && isWithinTwo(myState.agent, { r: rIdx, c: cIdx })) {
                      highlightClass = 'bg-emerald-950/40 border-emerald-500/60 hover:bg-emerald-900/50 cursor-pointer';
                    } else if (actionMode === 'snipe') {
                      highlightClass = 'bg-rose-950/30 border-rose-500/40 hover:bg-rose-900/50 cursor-pointer';
                    }
                  }

                  return (
                    <button key={key} onClick={() => handleCellClick(rIdx, cIdx)} className={`aspect-square rounded-xl border flex flex-col items-center justify-center relative transition ${highlightClass}`}>
                      <span className="absolute top-1 left-1.5 text-[9px] font-mono text-slate-600">{col}{row}</span>
                      {isMyAgent && <div className="flex flex-col items-center text-cyan-400"><Navigation className="w-5 h-5 fill-cyan-400/20" /><span className="text-[9px] font-bold">自分</span></div>}
                      {isMyData && <div className="flex flex-col items-center text-amber-400"><Briefcase className="w-5 h-5 fill-amber-400/20" /><span className="text-[9px] font-bold">機密</span></div>}
                      {isOppAgent && <div className="flex flex-col items-center text-rose-400"><Navigation className="w-5 h-5" /><span className="text-[9px] font-bold">敵駒</span></div>}
                      {isOppData && <div className="flex flex-col items-center text-rose-500"><Briefcase className="w-5 h-5" /><span className="text-[9px] font-bold">敵機密</span></div>}
                      {memoMark && !isMyAgent && !isMyData && <span className="text-base font-bold text-slate-300 opacity-90">{memoMark}</span>}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        {gameState.status === 'playing' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => setActionMode('move')} className={`py-2.5 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${actionMode === 'move' ? 'bg-cyan-600 border-cyan-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                <Navigation className="w-4 h-4" />移動
              </button>
              <button onClick={() => setActionMode('scan')} className={`py-2.5 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${actionMode === 'scan' ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                <Radar className="w-4 h-4" />スキャン
              </button>
              <button onClick={() => setActionMode('snipe')} className={`py-2.5 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${actionMode === 'snipe' ? 'bg-rose-600 border-rose-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                <Crosshair className="w-4 h-4" />狙撃
              </button>
              <button onClick={() => setActionMode('memo')} className={`py-2.5 px-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${actionMode === 'memo' ? 'bg-amber-600 border-amber-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                <HelpCircle className="w-4 h-4" />推理メモ
              </button>
            </div>

            {actionMode === 'memo' ? (
              <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-xs text-slate-400">盤面タップでメモ配置:</span>
                <div className="flex gap-1.5">
                  {['×', '？', '🕵️', '💼'].map((mark) => (
                    <button key={mark} onClick={() => setSelectedMemoMark(mark)} className={`w-8 h-8 rounded-lg text-sm font-bold border ${selectedMemoMark === mark ? 'bg-amber-500/20 border-amber-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                      {mark}
                    </button>
                  ))}
                  <button onClick={() => setMemos((prev) => ({ ...prev, [currentRole]: {} }))} className="px-2.5 h-8 rounded-lg text-xs bg-slate-900 border border-slate-700 text-slate-400 hover:text-rose-400">
                    全消去
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 text-center">
                {actionMode === 'move' && '上下左右の隣接1マスに移動します（方角のみ相手に通知されます）'}
                {actionMode === 'scan' && '自機から2マス以内を指定し、その周囲9マスに敵コマか機密があるか探知します'}
                {actionMode === 'snipe' && '敵の機密データがあると思う1マスを撃ち抜きます（的中すれば即勝利！）'}
              </p>
            )}
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
            <Terminal className="w-4 h-4 text-cyan-400" />
            行動・スキャン履歴ログ
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 text-xs">
            {[...gameState.logs].reverse().map((log, i) => (
              <div key={i} className={`p-2 rounded-lg border ${
                log.type === 'win' ? 'bg-amber-950/60 border-amber-500/50 text-amber-200 font-bold'
                  : log.type === 'scan-hit' ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                  : log.type === 'snipe-miss' ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                  : 'bg-slate-950 border-slate-800/80 text-slate-300'
              }`}>
                {log.text}
              </div>
            ))}
          </div>
        </div>

        <div className="text-center pb-4">
          <button onClick={() => setMode('lobby')} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300">
            <RotateCcw className="w-3.5 h-3.5" />
            タイトル・ロビーに戻る
          </button>
        </div>
      </div>
    </div>
  );
}