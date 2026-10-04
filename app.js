/* ============================================================
   Recipe Finder — application logic
   Vanilla JS app powered by TheMealDB (free, no API key).
   Docs: https://www.themealdb.com/api.php

   State model:
     - allMeals      : last full result set (search or category)
     - favorites     : array of meal ids persisted in localStorage
     - activeView    : 'all' | 'favorites'
     - activeCategory: currently selected category filter (or null)
   ============================================================ */

// ---------- Constants ----------
const API_BASE = 'https://www.themealdb.com/api/json/v1/1';
const FAVORITES_KEY = 'recipeFinderFavorites';
const DEBOUNCE_MS = 350;

// ---------- DOM references ----------
const searchInput   = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const categoryPills = document.getElementById('categoryPills');
const resultsGrid   = document.getElementById('resultsGrid');
const skeletonGrid  = document.getElementById('skeletonGrid');
const statusLine    = document.getElementById('statusLine');
const emptyState    = document.getElementById('emptyState');
const errorState    = document.getElementById('errorState');
const resetBtn      = document.getElementById('resetBtn');
const retryBtn      = document.getElementById('retryBtn');
const allTab        = document.getElementById('allTab');
const favTab        = document.getElementById('favTab');
const favCount      = document.getElementById('favCount');
const modalOverlay  = document.getElementById('modalOverlay');
const modalContent  = document.getElementById('modalContent');
const modalClose    = document.getElementById('modalClose');

// ---------- State ----------
let allMeals = [];          // meals from the latest search / category load
let favorites = loadFavorites();
let activeView = 'all';
let activeCategory = null;
let lastFailedAction = null; // retry callback for the error state

// ============================================================
// API helpers
// ============================================================

/** Fetch JSON, throwing a friendly error on network or HTTP failure. */
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

/** Search meals by name. Returns [] when nothing matches. */
async function searchMeals(query) {
  const data = await apiFetch(`${API_BASE}/search.php?s=${encodeURIComponent(query)}`);
  return data.meals || [];
}

/** Get the list of available categories. */
async function fetchCategories() {
  const data = await apiFetch(`${API_BASE}/list.php?c=list`);
  return (data.meals || []).map(c => c.strCategory);
}

/** Get meals in a category (thumbnail-level results). */
async function fetchMealsByCategory(category) {
  const data = await apiFetch(`${API_BASE}/filter.php?c=${encodeURIComponent(category)}`);
  return data.meals || [];
}

/** Get full detail for one meal, including ingredients and instructions. */
async function fetchMealDetail(id) {
  const data = await apiFetch(`${API_BASE}/lookup.php?i=${encodeURIComponent(id)}`);
  return (data.meals && data.meals[0]) || null;
}

/**
 * TheMealDB stores ingredients as strIngredient1..20 with matching
 * strMeasure1..20. Collect the non-empty pairs into a clean array.
 */
function extractIngredients(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (meal[`strIngredient${i}`] || '').trim();
    const measure = (meal[`strMeasure${i}`] || '').trim();
    if (name) ingredients.push({ name, measure });
  }
  return ingredients;
}

/**
 * Instructions arrive as one long paragraph. Split on sentence
 * boundaries into readable numbered steps, keeping short fragments
 * attached to the step before them.
 */
function splitInstructions(text) {
  if (!text) return [];
  const sentences = text
    .replace(/\r\n/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s.trim())
    .filter(Boolean);

  const steps = [];
  for (const sentence of sentences) {
    if (sentence.split(' ').length < 4 && steps.length) {
      steps[steps.length - 1] += ' ' + sentence; // fold fragments upward
    } else {
      steps.push(sentence);
    }
  }
  return steps;
}

// ============================================================
// Favorites (localStorage)
// ============================================================

function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  favCount.textContent = favorites.length;
}

function isFavorite(id) {
  return favorites.includes(id);
}

function toggleFavorite(id) {
  if (isFavorite(id)) {
    favorites = favorites.filter(f => f !== id);
  } else {
    favorites.push(id);
  }
  saveFavorites();
}

// ============================================================
// Rendering
// ============================================================

/** Show the loading skeleton grid, hiding everything else. */
function showLoading() {
  resultsGrid.innerHTML = '';
  resultsGrid.classList.add('hidden');
  emptyState.classList.add('hidden');
  errorState.classList.add('hidden');
  skeletonGrid.classList.remove('hidden');
  skeletonGrid.innerHTML = Array.from({ length: 8 }, () => `
    <div class="skeleton-card">
      <div class="skeleton" style="aspect-ratio: 4/3"></div>
      <div class="p-4">
        <div class="skeleton h-4 rounded mb-2"></div>
        <div class="skeleton h-4 rounded w-2/3"></div>
      </div>
    </div>`).join('');
  statusLine.textContent = '';
}

/** Show the error panel with a retry button. */
function showError(retryAction) {
  resultsGrid.classList.add('hidden');
  skeletonGrid.classList.add('hidden');
  emptyState.classList.add('hidden');
  errorState.classList.remove('hidden');
  statusLine.textContent = '';
  lastFailedAction = retryAction;
}

/** Render the given meals into the results grid. */
function renderMeals(meals) {
  skeletonGrid.classList.add('hidden');
  emptyState.classList.add('hidden');
  errorState.classList.add('hidden');

  if (!meals.length) {
    resultsGrid.classList.add('hidden');
    emptyState.classList.remove('hidden');
    statusLine.textContent = '';
    return;
  }

  resultsGrid.classList.remove('hidden');
  statusLine.textContent = meals.length === 1
    ? '1 recipe found'
    : `${meals.length} recipes found`;

  resultsGrid.innerHTML = meals.map((meal, index) => {
    const fav = isFavorite(meal.idMeal);
    const categoryLabel = meal.strCategory ? meal.strCategory : (activeCategory || '');
    return `
    <article class="recipe-card" style="animation-delay: ${Math.min(index * 30, 300)}ms"
             data-id="${meal.idMeal}" tabindex="0" role="button"
             aria-label="View details for ${escapeHtml(meal.strMeal)}">
      <img src="${meal.strMealThumb}" alt="${escapeHtml(meal.strMeal)}" loading="lazy" />
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(meal.strMeal)}</h3>
        <div class="card-meta">
          <span class="card-category">${escapeHtml(categoryLabel)}</span>
          <button class="fav-btn ${fav ? 'favorited' : ''}" data-fav="${meal.idMeal}"
                  aria-label="${fav ? 'Remove from' : 'Add to'} favorites" aria-pressed="${fav}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M4.3 12.9l5.2 5.2a1 1 0 001.4 0l8.8-8.8a4.5 4.5 0 00-6.4-6.4l-2.3 2.3-2.3-2.3a4.5 4.5 0 00-6.4 6.4l2 2z" />
            </svg>
          </button>
        </div>
      </div>
    </article>`;
  }).join('');
}

/** Render the category pill row. */
function renderCategories(categories) {
  const pills = ['<button class="category-pill active" data-category="">All</button>'];
  for (const cat of categories) {
    pills.push(`<button class="category-pill" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`);
  }
  categoryPills.innerHTML = pills.join('');
}

/** Mark one category pill as active. */
function setActivePill(category) {
  document.querySelectorAll('.category-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.category === category);
  });
}

/** Escape user/API text before injecting into HTML. */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Data loading flows
// ============================================================

/** Initial load: a broad search so the grid is full on first paint. */
async function loadInitialMeals() {
  showLoading();
  try {
    allMeals = await searchMeals('');
    renderMeals(visibleMeals());
  } catch {
    showError(loadInitialMeals);
  }
}

/** Search by name (debounced from the input). */
async function runSearch(query) {
  activeCategory = null;
  setActivePill('');
  showLoading();
  try {
    allMeals = await searchMeals(query);
    renderMeals(visibleMeals());
  } catch {
    showError(() => runSearch(query));
  }
}

/** Browse meals in one category. */
async function browseCategory(category) {
  activeCategory = category;
  setActivePill(category);
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  showLoading();
  try {
    allMeals = category ? await fetchMealsByCategory(category) : await searchMeals('');
    renderMeals(visibleMeals());
  } catch {
    showError(() => browseCategory(category));
  }
}

/** Meals to display after applying the current view filter. */
function visibleMeals() {
  if (activeView === 'favorites') {
    const favSet = new Set(favorites);
    return allMeals.filter(m => favSet.has(m.idMeal));
  }
  return allMeals;
}

// ============================================================
// Views (All / Favorites tabs)
// ============================================================

function setView(view) {
  activeView = view;
  const isFav = view === 'favorites';
  favTab.classList.toggle('active', isFav);
  allTab.classList.toggle('active', !isFav);
  favTab.setAttribute('aria-pressed', isFav);
  allTab.setAttribute('aria-pressed', !isFav);
  categoryPills.classList.toggle('opacity-40', isFav);
  categoryPills.classList.toggle('pointer-events-none', isFav);
  renderMeals(visibleMeals());
}

// ============================================================
// Meal detail modal
// ============================================================

async function openMealModal(id) {
  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  modalContent.innerHTML = `
    <div class="p-8">
      <div class="skeleton h-56 rounded-xl mb-4"></div>
      <div class="skeleton h-6 rounded w-3/4 mb-2"></div>
      <div class="skeleton h-4 rounded w-1/2"></div>
    </div>`;

  try {
    const meal = await fetchMealDetail(id);
    if (!meal) throw new Error('Meal not found');

    const ingredients = extractIngredients(meal);
    const steps = splitInstructions(meal.strInstructions);
    const fav = isFavorite(meal.idMeal);

    modalContent.innerHTML = `
      <img class="modal-hero" src="${meal.strMealThumb}" alt="${escapeHtml(meal.strMeal)}" />
      <div class="p-6 sm:p-8">
        <div class="flex items-start justify-between gap-4">
          <h2 id="modalTitle" class="font-display text-2xl sm:text-3xl font-semibold text-stone-900">
            ${escapeHtml(meal.strMeal)}
          </h2>
          <button class="fav-btn ${fav ? 'favorited' : ''} flex-shrink-0" data-fav="${meal.idMeal}"
                  aria-label="${fav ? 'Remove from' : 'Add to'} favorites" aria-pressed="${fav}"
                  style="width:2.75rem;height:2.75rem">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" class="w-6 h-6">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M4.3 12.9l5.2 5.2a1 1 0 001.4 0l8.8-8.8a4.5 4.5 0 00-6.4-6.4l-2.3 2.3-2.3-2.3a4.5 4.5 0 00-6.4 6.4l2 2z" />
            </svg>
          </button>
        </div>

        <div class="flex flex-wrap gap-2 mt-4">
          ${meal.strCategory ? `<span class="tag">${escapeHtml(meal.strCategory)}</span>` : ''}
          ${meal.strArea ? `<span class="tag">${escapeHtml(meal.strArea)}</span>` : ''}
          ${meal.strTags ? meal.strTags.split(',').slice(0, 3).map(t =>
            `<span class="tag">${escapeHtml(t.trim())}</span>`).join('') : ''}
        </div>

        <h3 class="text-lg font-semibold mt-8 mb-3">Ingredients <span class="text-sm font-normal text-stone-400">(tap to check off)</span></h3>
        <ul class="grid sm:grid-cols-2 gap-2">
          ${ingredients.map(ing => `
            <li class="ingredient-item">
              <input type="checkbox" aria-label="${escapeHtml(ing.name)}" />
              <span class="ingredient-name font-medium">${escapeHtml(ing.name)}</span>
              <span class="text-stone-500 ml-auto text-right">${escapeHtml(ing.measure)}</span>
            </li>`).join('')}
        </ul>

        <h3 class="text-lg font-semibold mt-8 mb-4">Instructions</h3>
        <ol class="space-y-4">
          ${steps.map((step, i) => `
            <li class="flex gap-3">
              <span class="step-number">${i + 1}</span>
              <p class="text-stone-700 leading-relaxed pt-1">${escapeHtml(step)}</p>
            </li>`).join('')}
        </ol>

        <div class="flex flex-wrap gap-3 mt-8 pt-6 border-t border-stone-200">
          ${meal.strYoutube ? `
            <a href="${meal.strYoutube}" target="_blank" rel="noopener"
               class="btn-primary no-underline">▶ Watch video tutorial</a>` : ''}
          ${meal.strSource ? `
            <a href="${meal.strSource}" target="_blank" rel="noopener"
               class="inline-flex items-center px-5 py-3 rounded-full border border-stone-300 text-sm font-semibold text-stone-700 hover:border-brand-400 hover:text-brand-600 transition">
              View original recipe
            </a>` : ''}
        </div>
      </div>`;
  } catch {
    modalContent.innerHTML = `
      <div class="p-10 text-center">
        <div class="text-5xl mb-4">⚠️</div>
        <h2 class="text-xl font-semibold mb-2">Could not load this recipe</h2>
        <p class="text-stone-500 mb-6">Please check your connection and try again.</p>
        <button class="btn-primary" onclick="document.getElementById('modalOverlay').classList.add('hidden');document.body.style.overflow=''">
          Close
        </button>
      </div>`;
  }
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// ============================================================
// Events
// ============================================================

// Debounced search as the user types.
let searchTimer = null;
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  clearSearchBtn.classList.toggle('hidden', !query);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (activeView === 'favorites') setView('all');
    runSearch(query);
  }, DEBOUNCE_MS);
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  if (activeView === 'favorites') setView('all');
  browseCategory('');
  searchInput.focus();
});

// Category pills (event delegation).
categoryPills.addEventListener('click', (e) => {
  const pill = e.target.closest('.category-pill');
  if (!pill) return;
  browseCategory(pill.dataset.category);
});

// Cards: favorite button or open modal (event delegation).
resultsGrid.addEventListener('click', (e) => {
  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) {
    e.stopPropagation();
    const id = favBtn.dataset.fav;
    toggleFavorite(id);
    const nowFav = isFavorite(id);
    document.querySelectorAll(`[data-fav="${id}"]`).forEach(btn => {
      btn.classList.toggle('favorited', nowFav);
      btn.setAttribute('aria-pressed', nowFav);
      btn.setAttribute('aria-label', nowFav ? 'Remove from favorites' : 'Add to favorites');
    });
    // If viewing favorites, removing one should drop it from the grid.
    if (activeView === 'favorites') renderMeals(visibleMeals());
    return;
  }
  const card = e.target.closest('.recipe-card');
  if (card) openMealModal(card.dataset.id);
});

// Keyboard support: Enter opens the card's modal.
resultsGrid.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const card = e.target.closest('.recipe-card');
    if (card) openMealModal(card.dataset.id);
  }
});

// Modal interactions.
modalContent.addEventListener('click', (e) => {
  // Favorite button inside the modal reuses the same data-fav hook.
  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) {
    const id = favBtn.dataset.fav;
    toggleFavorite(id);
    const nowFav = isFavorite(id);
    favBtn.classList.toggle('favorited', nowFav);
    favBtn.setAttribute('aria-pressed', nowFav);
    // Keep the grid card in sync behind the modal.
    document.querySelectorAll(`#resultsGrid [data-fav="${id}"]`).forEach(btn => {
      btn.classList.toggle('favorited', nowFav);
      btn.setAttribute('aria-pressed', nowFav);
    });
    return;
  }
  // Ingredient checklist toggling.
  const item = e.target.closest('.ingredient-item');
  if (item) {
    const box = item.querySelector('input[type="checkbox"]');
    if (e.target !== box) box.checked = !box.checked;
    item.classList.toggle('checked', box.checked);
  }
});

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) closeModal();
});

// Tabs, reset, retry.
allTab.addEventListener('click', () => setView('all'));
favTab.addEventListener('click', () => setView('favorites'));
resetBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  setView('all');
  browseCategory('');
});
retryBtn.addEventListener('click', () => {
  if (typeof lastFailedAction === 'function') lastFailedAction();
});

// ============================================================
// Init
// ============================================================

(async function init() {
  favCount.textContent = favorites.length;
  try {
    const categories = await fetchCategories();
    renderCategories(categories);
  } catch {
    // Categories are a nice-to-have; the app still works without them.
    categoryPills.innerHTML = '<span class="text-sm text-stone-400">Categories unavailable</span>';
  }
  loadInitialMeals();
})();
