const form = document.querySelector("#form");
const input = document.querySelector("#url");
const submit = document.querySelector("#submit");
const status = document.querySelector("#status");
const results = document.querySelector("#results");

const viaText = {
  input: "Yazdığınız adres fiyat sayfası olarak kullanıldı.",
  link: "Fiyat sayfası ana sayfadaki bir bağlantıdan bulundu.",
  path: "Fiyat sayfası yaygın bir yoldan denendi (/pricing, /plans, /fiyatlar).",
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void lookup(input.value);
});

for (const button of document.querySelectorAll("[data-example]")) {
  button.addEventListener("click", () => {
    input.value = button.dataset.example || "";
    void lookup(input.value);
  });
}

async function lookup(raw) {
  const url = raw.trim();
  if (!url) return;
  setBusy(true);
  status.innerHTML = "";
  results.innerHTML = "";
  status.append(banner("Sayfa tarayıcıda açılıyor, fiyat anahtarları deneniyor…", "loading"));
  results.append(skeletonGrid());

  try {
    const response = await fetch("/api/pricing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();
    results.innerHTML = "";
    status.innerHTML = "";
    if (!response.ok || !data.ok) {
      status.append(banner(data.error || "Bir sorun oluştu.", "error"));
      return;
    }
    render(data);
  } catch {
    results.innerHTML = "";
    status.innerHTML = "";
    status.append(banner("Sunucuya ulaşılamadı. Biraz sonra yeniden deneyin.", "error"));
  } finally {
    setBusy(false);
  }
}

function render(data) {
  if (data.note) status.append(banner(data.note, "info"));
  const head = document.createElement("div");
  head.className = "result-head";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = data.site || "Sonuç";
  titleWrap.append(title);
  const source = document.createElement("p");
  source.className = "source";
  source.append("Kaynak: ");
  const link = document.createElement("a");
  link.href = data.pricingUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = data.pricingUrl;
  source.append(link);
  titleWrap.append(source);
  const via = document.createElement("p");
  via.className = "via";
  via.textContent = viaText[data.via] || "";
  titleWrap.append(via);
  head.append(titleWrap);
  results.append(head);

  if (!data.plans || data.plans.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = data.message || "Fiyat bulunamadı.";
    results.append(empty);
    return;
  }

  const groups = groupPlans(data.plans);
  const showHeadings = groups.length > 1 || groups[0].name !== "Diğer";
  for (const group of groups) {
    const block = document.createElement("section");
    block.className = "period-block";
    if (showHeadings) {
      const heading = document.createElement("h3");
      heading.textContent = group.name;
      block.append(heading);
    }
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const plan of group.plans) grid.append(card(plan));
    block.append(grid);
    results.append(block);
  }
}

function groupPlans(plans) {
  const order = ["Aylık", "Yıllık", "Diğer"];
  const buckets = new Map(order.map((name) => [name, []]));
  for (const plan of plans) {
    const period = `${plan.period || ""}`.toLocaleLowerCase("tr");
    const name = period.includes("yıl") || period.includes("year") || period.includes("annual")
      ? "Yıllık"
      : period.includes("ay") || period.includes("month")
        ? "Aylık"
        : "Diğer";
    buckets.get(name).push(plan);
  }
  return order
    .filter((name) => buckets.get(name).length)
    .map((name) => ({ name, plans: buckets.get(name) }));
}

function card(plan) {
  const article = document.createElement("article");
  article.className = "card";
  const name = document.createElement("h3");
  name.textContent = plan.name || "Plan";
  const amount = document.createElement("p");
  amount.className = "amount";
  amount.textContent = plan.price || "Fiyat yok";
  article.append(name, amount);
  const metaBits = [plan.currency, plan.period].filter(Boolean);
  if (metaBits.length) {
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = metaBits.join(" · ");
    article.append(meta);
  }
  if (plan.features && plan.features.length) {
    const list = document.createElement("ul");
    for (const feature of plan.features) {
      const item = document.createElement("li");
      item.textContent = feature;
      list.append(item);
    }
    article.append(list);
  }
  if (plan.notes) {
    const notes = document.createElement("p");
    notes.className = "notes";
    notes.textContent = plan.notes;
    article.append(notes);
  }
  return article;
}

function banner(text, kind) {
  const node = document.createElement("div");
  node.className = `banner ${kind}`;
  node.setAttribute("role", kind === "error" ? "alert" : "status");
  node.textContent = text;
  return node;
}

function skeletonGrid() {
  const grid = document.createElement("div");
  grid.className = "grid";
  for (let i = 0; i < 3; i += 1) {
    const block = document.createElement("div");
    block.className = "skeleton";
    grid.append(block);
  }
  return grid;
}

function setBusy(busy) {
  submit.disabled = busy;
  input.disabled = busy;
  submit.textContent = busy ? "Aranıyor…" : "Planları bul";
}
