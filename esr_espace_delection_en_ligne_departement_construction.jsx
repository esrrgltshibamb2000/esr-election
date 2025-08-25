import React, { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ShieldCheck, Vote, Send, BarChart3, Download, Upload, Info } from "lucide-react";

/*
  NOTE: build-safe version
  - Removed any external image/network fetches to avoid build-time failures in sandbox.
  - Uses an inline SVG (text) logo instead of loading from /mnt/data or CDN.
  - Keeps the same functionality: one vote per device + one vote per phone number (normalized).
  - Adds simple admin/export/import features and a small test helper `runElectionTests()` you can call
    from the browser console to populate sample votes and validate tally logic.
*/

const ELECTION_CONFIG = {
  org: "ESR — Ensemble sur la Réussite",
  dept: "Département de la Construction",
  races: [
    {
      id: "dg-construction",
      title: "Directeur Général de la Construction",
      candidates: [
        { id: "ndona-joel", name: "Ingénieur Ndona Joël" },
        { id: "toussaint-enock", name: "Ingénieur Toussaint Enock" },
        { id: "parfait-kukambisa", name: "Ingénieur Parfait Kukambisa" },
      ],
    },
    {
      id: "rep-etude-conception",
      title: "Représentant du Service Étude & Conception Technique",
      candidates: [
        { id: "achema-tonny", name: "Ingénieur Achema Tonny" },
        { id: "bawota-bibiane", name: "Architecte Bawota Bibiane" },
      ],
    },
  ],
  adminPIN: "1234",
  adminWhatsApp: "+243834757010",
};

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function saveFile(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i] ?? ""));
    return obj;
  });
}

// normalize phone numbers to digits only for comparison
function normalizePhone(p) {
  return (p || "").replace(/[^0-9]/g, "");
}

// Helper (for manual testing from console) - creates sample votes
export function runElectionTests() {
  const sample = [
    { name: "Test One", phone: "+243970000001", choices: { "dg-construction": "ndona-joel", "rep-etude-conception": "achema-tonny" } },
    { name: "Test Two", phone: "+243970000002", choices: { "dg-construction": "toussaint-enock", "rep-etude-conception": "bawota-bibiane" } },
    { name: "Test Three", phone: "+243970000003", choices: { "dg-construction": "ndona-joel", "rep-etude-conception": "achema-tonny" } },
  ];
  const store = JSON.parse(localStorage.getItem("esr_votes_store") || "[]");
  sample.forEach(s => {
    const rec = { id: uuid(), ts: new Date().toISOString(), voter: { name: s.name, phone: s.phone }, choices: s.choices, note: "(test)" };
    store.push(rec);
  });
  localStorage.setItem("esr_votes_store", JSON.stringify(store));
  console.log("Inserted sample votes (3)");
  return computeTally();
}

// compute tally from localStorage votes
function computeTally() {
  const store = JSON.parse(localStorage.getItem("esr_votes_store") || "[]");
  const tally = {};
  ELECTION_CONFIG.races.forEach((race) => {
    tally[race.id] = { total: 0 };
    race.candidates.forEach((c) => (tally[race.id][c.id] = 0));
  });
  store.forEach((r) => {
    ELECTION_CONFIG.races.forEach((race) => {
      const cid = r.choices?.[race.id];
      if (cid) {
        tally[race.id].total += 1;
        if (tally[race.id][cid] !== undefined) tally[race.id][cid] += 1;
      }
    });
  });
  return tally;
}

export default function ElectionESR() {
  const [voter, setVoter] = useState({ name: "", phone: "", code: "" });
  const [choices, setChoices] = useState(() => {
    // prefill choices from localStorage ballot (if any)
    try {
      const s = JSON.parse(localStorage.getItem("esr_ballot") || "null");
      return s?.choices || {};
    } catch { return {}; }
  });
  const [hasVoted, setHasVoted] = useState(() => !!localStorage.getItem("esr_has_voted"));
  const [receipt, setReceipt] = useState("");
  const [note, setNote] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [pin, setPin] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("esr_ballot") || "null");
      if (saved?.voter) setVoter(saved.voter);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("esr_ballot", JSON.stringify({ voter, choices }));
  }, [voter, choices]);

  const validation = useMemo(() => {
    const errors = [];
    ELECTION_CONFIG.races.forEach((race) => {
      const sel = choices[race.id];
      if (!sel) errors.push(`Choisissez un candidat pour « ${race.title} ».`);
    });
    if (!voter.name.trim()) errors.push("Entrez votre nom complet.");
    if (!voter.phone.trim()) errors.push("Entrez votre téléphone (WhatsApp).");
    return { ok: errors.length === 0, errors };
  }, [choices, voter]);

  function submitBallot() {
    if (!validation.ok || hasVoted) return;
    const id = uuid();

    const store = JSON.parse(localStorage.getItem("esr_votes_store") || "[]");
    const normalized = normalizePhone(voter.phone);
    const alreadyVoted = store.find(v => normalizePhone(v.voter.phone) === normalized);
    if (alreadyVoted) {
      alert("Ce numéro WhatsApp a déjà voté.");
      setHasVoted(true);
      setReceipt(alreadyVoted.id);
      localStorage.setItem("esr_has_voted", "yes");
      return;
    }

    const record = { id, ts: new Date().toISOString(), voter: { ...voter, phone: normalized }, choices, note: note.trim() };
    store.push(record);
    localStorage.setItem("esr_votes_store", JSON.stringify(store));
    localStorage.setItem("esr_has_voted", "yes");
    setHasVoted(true);
    setReceipt(id);

    // Prepare WhatsApp message and open WhatsApp (user must press Send)
    const lines = [
      `Bonjour Admin ESR,`,
      `Voici mon vote :`,
      ...ELECTION_CONFIG.races.map(r => `- ${r.title} : ${r.candidates.find(c => c.id === choices[r.id])?.name || ""}`),
      "",
      `Nom : ${voter.name}`,
      `Téléphone : ${voter.phone}`,
      `Reçu : ${id}`,
    ];
    const msg = lines.join("\n");
    const adminPhone = (ELECTION_CONFIG.adminWhatsApp || "").replace(/[^0-9]/g, "");
    const url = `https://wa.me/${adminPhone}?text=${encodeURIComponent(msg)}`;
    // Open in a new tab/window - user must confirm Send in WhatsApp
    try { window.open(url, "_blank"); } catch (e) { console.warn("Impossible d'ouvrir WhatsApp", e); }
  }

  function exportVotes() {
    const store = JSON.parse(localStorage.getItem("esr_votes_store") || "[]");
    if (!store.length) return alert("Aucun vote à exporter sur cet appareil.");
    const headers = ["id", "timestamp", "voter_name", "voter_phone", ...ELECTION_CONFIG.races.map(r => `vote_${r.id}`), "note"];
    const rows = [headers.join(",")];
    store.forEach(r => {
      const cols = [r.id, r.ts, r.voter?.name || "", r.voter?.phone || "", ...ELECTION_CONFIG.races.map(race => r.choices?.[race.id] || ""), (r.note || "").replace(/,/g, ";")];
      rows.push(cols.join(","));
    });
    saveFile("esr_votes_export.csv", rows.join("\n"));
  }

  function importVotesFromCSV(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result + "";
      const rows = parseCSV(text);
      const existing = JSON.parse(localStorage.getItem("esr_votes_store") || "[]");
      const byId = new Map(existing.map(r => [r.id, r]));
      rows.forEach(row => {
        if (!row.id) return;
        if (!byId.has(row.id)) {
          const rec = {
            id: row.id,
            ts: row.timestamp,
            voter: { name: row.voter_name, phone: row.voter_phone },
            choices: Object.fromEntries(ELECTION_CONFIG.races.map(r => [r.id, row[`vote_${r.id}`]])),
            note: row.note,
          };
          existing.push(rec);
          byId.set(rec.id, rec);
        }
      });
      localStorage.setItem("esr_votes_store", JSON.stringify(existing));
      alert("Importation terminée.");
    };
    reader.readAsText(file);
  }

  const tally = computeTally();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <header className="mb-6 text-center">
          {/* Inline simple text/logo to avoid external fetch */}
          <div className="mx-auto w-28 h-12 flex items-center justify-center rounded-md bg-white shadow-sm mb-3">
            <strong className="text-sm">ESR</strong>
          </div>
          <div className="inline-flex items-center gap-2 text-sm text-gray-600">
            <ShieldCheck className="w-5 h-5" />
            <span>Espace d’élection sécurisé — {ELECTION_CONFIG.org}</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mt-2">{ELECTION_CONFIG.dept}</h1>
          <p className="text-gray-600 mt-1">Vote en ligne pour deux postes — Un seul vote par appareil.</p>
        </header>

        <Tabs defaultValue="voter">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="voter">Voter</TabsTrigger>
            <TabsTrigger value="resultats">Résultats (local)</TabsTrigger>
            <TabsTrigger value="admin">Admin</TabsTrigger>
          </TabsList>

          {/* Voter tab */}
          <TabsContent value="voter">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Vote className="w-5 h-5" />Bulletin de vote</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {hasVoted ? (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-2xl flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 mt-0.5" />
                    <div>
                      <p className="font-medium">Merci, votre vote a été enregistré sur cet appareil.</p>
                      {receipt && (
                        <p className="text-sm text-gray-600 mt-1">Code de reçu : <span className="font-mono">{receipt}</span></p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3">
                      <Label>Nom complet</Label>
                      <Input placeholder="Votre nom et prénom" value={voter.name} onChange={(e) => setVoter({ ...voter, name: e.target.value })} />
                    </div>
                    <div className="grid gap-3">
                      <Label>Téléphone (WhatsApp)</Label>
                      <Input placeholder="Ex: +243 97 ..." value={voter.phone} onChange={(e) => setVoter({ ...voter, phone: e.target.value })} />
                    </div>
                    <div className="grid gap-3">
                      <Label>Remarque (optionnel)</Label>
                      <Textarea placeholder="Votre suggestion pour améliorer le département…" value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                    {ELECTION_CONFIG.races.map((race) => (
                      <div key={race.id} className="p-4 rounded-2xl border bg-white">
                        <div className="font-semibold mb-2">{race.title}</div>
                        <RadioGroup value={choices[race.id] || ""} onValueChange={(val) => setChoices({ ...choices, [race.id]: val })}>
                          {race.candidates.map((c) => (
                            <div key={c.id} className="flex items-center space-x-2 py-1">
                              <RadioGroupItem value={c.id} id={`${race.id}-${c.id}`} />
                              <Label htmlFor={`${race.id}-${c.id}`}>{c.name}</Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    ))}
                    {/* show validation errors if any */}
                    {!validation.ok && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-sm">
                        <div className="flex items-center gap-2 font-medium"><Info className="w-4 h-4"/> Complétez votre bulletin :</div>
                        <ul className="list-disc ml-6 mt-1">
                          {validation.errors.map((e,i) => <li key={i}>{e}</li>)}
                        </ul>
                      </div>
                    )}
                    <Button onClick={submitBallot} disabled={!validation.ok || hasVoted} className="rounded-2xl px-6 mt-3">
                      <Send className="w-4 h-4 mr-2" /> Soumettre mon vote et envoyer sur WhatsApp
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Results tab */}
          <TabsContent value="resultats">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5"/>Résultats (local)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {ELECTION_CONFIG.races.map((race) => {
                  const total = tally[race.id]?.total || 0;
                  return (
                    <div key={race.id}>
                      <div className="font-semibold mb-2">{race.title}</div>
                      <div className="space-y-2">
                        {race.candidates.map((c) => {
                          const count = tally[race.id]?.[c.id] || 0;
                          const pct = total ? Math.round((count/total)*100) : 0;
                          return (
                            <div key={c.id}>
                              <div className="flex justify-between text-sm mb-1">
                                <span>{c.name}</span>
                                <span className="font-mono">{count} ({pct}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2"><div style={{width: `${pct}%`}} className="h-2 rounded-full bg-gray-400"></div></div>
                            </div>
                          );
                        })}
                        <div className="text-xs text-gray-500">Total des bulletins comptés ici : {total}</div>
                      </div>
                      <div className="my-4 border-t" />
                    </div>
                  );
                })}

                <div className="flex flex-wrap gap-3">
                  <Button onClick={exportVotes} className="rounded-2xl"><Download className="w-4 h-4 mr-2"/>Exporter en CSV</Button>
                  <label className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border cursor-pointer bg-white">
                    <Upload className="w-4 h-4"/>
                    <span>Importer des votes (CSV)</span>
                    <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importVotesFromCSV(e.target.files[0])} />
                  </label>
                </div>

                <p className="text-xs text-gray-500">Astuce : les responsables peuvent rassembler les fichiers CSV de plusieurs appareils pour obtenir le total global.</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Admin tab */}
          <TabsContent value="admin">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Administration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!adminMode ? (
                  <div className="flex items-end gap-3">
                    <div className="grid gap-2">
                      <Label>Entrer le code PIN</Label>
                      <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-44"/>
                    </div>
                    <Button onClick={() => setAdminMode(pin === ELECTION_CONFIG.adminPIN)} className="rounded-2xl">Ouvrir</Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-sm">
                      Connecté en mode administrateur. Pensez à <b>changer le PIN</b> dans la configuration avant diffusion publique.
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button variant="destructive" onClick={() => { localStorage.removeItem("esr_has_voted"); setHasVoted(false); setReceipt(""); }} className="rounded-2xl">Autoriser un nouveau vote sur cet appareil</Button>
                      <Button variant="secondary" onClick={() => { localStorage.removeItem("esr_votes_store"); alert("Votes locaux effacés."); }} className="rounded-2xl">Effacer les votes locaux</Button>
                      <Button variant="secondary" onClick={() => { localStorage.removeItem("esr_ballot"); setChoices({}); setVoter({ name: "", phone: "", code: "" }); }} className="rounded-2xl">Réinitialiser le bulletin</Button>
                    </div>

                    <div className="text-sm text-gray-600 leading-relaxed">
                      <p className="font-medium">Procédure de consolidation des résultats (sans serveur) :</p>
                      <ol className="list-decimal ml-5 mt-1 space-y-1">
                        <li>Chaque responsable exporte le CSV depuis l’onglet <i>Résultats</i> de son appareil.</li>
                        <li>Vous regroupez les CSV dans Excel/Google Sheets en supprimant les doublons par <code>id</code>.</li>
                        <li>Vous calculez les totaux pour chaque candidat.</li>
                      </ol>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <footer className="text-xs text-gray-500 mt-6 text-center">
          Données stockées uniquement sur l’appareil. Pour un déploiement web multi-utilisateurs (avec serveur, codes uniques, etc.), connectez cette page à une base de données (ex: Supabase/Firebase) ou un backend interne ESR.
        </footer>
      </div>
    </div>
  );
}
