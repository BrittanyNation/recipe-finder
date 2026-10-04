# Recipe Finder

A responsive recipe discovery web app built with vanilla JavaScript and Tailwind CSS. Search thousands of recipes by name, browse by category, open full recipe details with ingredients and step-by-step instructions, and save favorites to your browser.

## Features

- **Live search** — debounced search-as-you-type across the recipe database
- **Category browsing** — filter recipes with pill navigation (Beef, Chicken, Seafood, Vegetarian, Dessert, and more)
- **Recipe detail modal** — photo, category/area tags, checkable ingredient list with measures, numbered instructions, and a YouTube tutorial link when available
- **Favorites** — heart any recipe; favorites persist in `localStorage` and have their own tab
- **Polished states** — loading skeletons, empty results, and error states with retry
- **Responsive** — mobile-first grid, full-screen modal on small screens
- **Accessible** — keyboard navigation, ARIA labels, visible focus states

## Tech

- HTML, CSS (Tailwind via CDN + custom `styles.css`), vanilla JavaScript (`app.js`)
- [TheMealDB](https://www.themealdb.com/api.php) — free recipe API, no key required

## Run locally

No build step needed. Serve the folder with any static server:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

Then open `http://localhost:8080` in your browser.

## Live demo

Hosted with GitHub Pages: https://brittanynation.github.io/recipe-finder/

## API credit

Recipe data provided by [TheMealDB](https://www.themealdb.com/api.php) — a free, crowdsourced recipe database.
