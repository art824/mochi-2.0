// Dev only (not shipped): the island preview with the Notifications or the Media pill in front.
//   const m = await import("/dev/media-scene.ts"); await m.notifs();   // or: await m.media({ playing: true });
import { State } from "../src/core/state";
import { Media, applyMedia, EMPTY_MEDIA, MEDIA_ID } from "../src/core/media";
import { NOTIF_ID, PHONE_ID, pushNotif } from "../src/core/notifications";

function cover(): string {
  const c = document.createElement("canvas");
  c.width = c.height = 300;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 300, 300);
  gr.addColorStop(0, "#2a9d8f");
  gr.addColorStop(1, "#1b2a49");
  g.fillStyle = gr;
  g.fillRect(0, 0, 300, 300);
  g.fillStyle = "rgba(255,255,255,.16)";
  g.beginPath();
  g.arc(90, 200, 80, 0, 7);
  g.fill();
  return c.toDataURL("image/jpeg", 0.9);
}

async function front(id: string) {
  const island = (window as any).__island;
  if (!State.settings.activeIntegrations.includes(id)) {
    State.settings = { ...State.settings, activeIntegrations: [...State.settings.activeIntegrations, id] };
  }
  State.loadIntegrationTasks();
  island.fsm.forceHome();
  island.fsm.pinned = true;
  await new Promise((r) => setTimeout(r, 1200));
  State.setFocus(id);
  State.view = "overview";
  State.notify();
  await new Promise((r) => setTimeout(r, 1200));
}

export async function notifs(n = 4) {
  const items = [
    { app: "Chrome", title: "Nova resposta no seu comentário", body: "Lucas: concordo, mas acho que vale testar com o agregado antes de fechar a conclusão.", whatsapp: false },
    { app: "OneDrive", title: "Sincronização concluída", body: "Todos os seus arquivos estão atualizados.", whatsapp: false },
    { app: "Ferramenta de Captura", title: "Captura salva", whatsapp: false },
    { app: "Windows PowerShell", title: "Build pronto", body: "coucou.exe compilado sem erros.", whatsapp: false },
  ];
  for (const it of items.slice(0, n).reverse()) pushNotif(it, Date.now() - Math.random() * 600_000);
  await front(NOTIF_ID);
}

export async function phone(long = true) {
  const items = [
    { app: "Instagram", title: "julia.m curtiu sua foto", phone: true, whatsapp: false },
    { app: "WhatsApp", title: "Mãe", body: "Chegou bem?", phone: true, whatsapp: true },
    { app: "WhatsApp", title: "Ana Souza", phone: true, whatsapp: true,
      body: long
        ? "Oi! Vi o protótipo do Mochi, ficou muito bom. Duas coisas: o card de notificação podia mostrar a mensagem inteira, e quando chega uma nova a ilha devia abrir sozinha. Consegue ver isso até amanhã? Se precisar, te mando os prints que tirei hoje de manhã com os detalhes."
        : "Bora almoçar?" },
  ];
  for (const it of items) pushNotif(it, Date.now() - Math.random() * 300_000);
  await front(PHONE_ID);
}

export async function media(o: { playing?: boolean; present?: boolean } = {}) {
  const present = o.present ?? true;
  Media.art = null;
  applyMedia(present ? {
    ...EMPTY_MEDIA, present: true, app: "Chrome", title: "Lofi hip hop radio — beats to relax/study to",
    artist: "Lofi Girl", playing: o.playing ?? true, position: 84, duration: 3600, atMs: Date.now(),
    art: cover(), artKey: "k1", volume: 62,
  } : EMPTY_MEDIA);
  await front(MEDIA_ID);
}
