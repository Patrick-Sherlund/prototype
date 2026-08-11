const products = [
  {
    id: 1,
    name: 'Premium Roma Tomato Case',
    brand: 'Fresh Market Select',
    category: 'Produce',
    pack: '25 LB CS',
    casePrice: 38.45,
    eachPrice: 1.54,
    image:
      'https://images.unsplash.com/photo-1561136594-7f68413baa99?auto=format&fit=crop&w=900&q=80',
    tags: ['Previously Purchased', 'Fresh', 'Local'],
    lastOrdered: '2 days ago',
  },
  {
    id: 2,
    name: 'Center Cut Angus Striploin',
    brand: 'PrimeSource Beef',
    category: 'Meats',
    pack: '2/12 LB AVG',
    casePrice: 212.1,
    eachPrice: 8.84,
    image:
      'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=900&q=80',
    tags: ['High Volume', 'Protein'],
    lastOrdered: '6 days ago',
  },
  {
    id: 3,
    name: 'Brioche Burger Bun Sliced',
    brand: "Baker's Line",
    category: 'Bakery',
    pack: '8/12 CT CS',
    casePrice: 41.8,
    eachPrice: 0.44,
    image:
      'https://images.unsplash.com/photo-1620921568790-c1cf8984624c?auto=format&fit=crop&w=900&q=80',
    tags: ['Favorite', 'Bakery'],
    lastOrdered: 'Yesterday',
  },
  {
    id: 4,
    name: 'Avocado Hass Ready-To-Use',
    brand: 'Greenway Produce',
    category: 'Produce',
    pack: '48 CT CS',
    casePrice: 62.25,
    eachPrice: 1.3,
    image:
      'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=900&q=80',
    tags: ['Fresh', 'Trending'],
    lastOrdered: '4 days ago',
  },
  {
    id: 5,
    name: 'Compostable Hinged Container',
    brand: 'Earth Table',
    category: 'Supplies',
    pack: '2/100 CT CS',
    casePrice: 54.9,
    eachPrice: 0.27,
    image:
      'https://images.unsplash.com/photo-1611284446314-60a58ac0deb9?auto=format&fit=crop&w=900&q=80',
    tags: ['Sustainable', 'Non-Food'],
    lastOrdered: '12 days ago',
  },
  {
    id: 6,
    name: 'Cold Brew Coffee Concentrate',
    brand: 'RoastWorks',
    category: 'Beverages',
    pack: '6/32 OZ CS',
    casePrice: 76.35,
    eachPrice: 12.73,
    image:
      'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=900&q=80',
    tags: ['New', 'Beverage'],
    lastOrdered: 'Never',
  },
];

const categories = ['All Categories', 'Produce', 'Meats', 'Bakery', 'Beverages', 'Supplies'];
const navItems = [
  ['Products', 'P'],
  ['Lists', 'L'],
  ['Orders', 'O'],
  ['Delivery', 'D'],
  ['Account', 'A'],
];

const state = {
  activeNav: 'Products',
  query: '',
  category: 'All Categories',
  cart: { 1: 2, 3: 1 },
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function filteredProducts() {
  return products.filter((product) => {
    const matchesCategory = state.category === 'All Categories' || product.category === state.category;
    const matchesQuery = `${product.name} ${product.brand} ${product.category}`
      .toLowerCase()
      .includes(state.query.toLowerCase());
    return matchesCategory && matchesQuery;
  });
}

function cartLines() {
  return products
    .filter((product) => state.cart[product.id])
    .map((product) => ({ ...product, quantity: state.cart[product.id] }));
}

function updateQuantity(productId, delta) {
  const nextQuantity = Math.max((state.cart[productId] || 0) + delta, 0);
  if (nextQuantity === 0) {
    delete state.cart[productId];
  } else {
    state.cart[productId] = nextQuantity;
  }
  render();
}

function renderNav() {
  byId('nav-list').innerHTML = navItems
    .map(
      ([label, icon]) => `
        <button class="nav-button ${state.activeNav === label ? 'active' : ''}" data-action="nav" data-label="${label}">
          <span class="nav-icon">${icon}</span>
          <span>${label}</span>
        </button>
      `,
    )
    .join('');
}

function renderFilters() {
  byId('filter-list').innerHTML = categories
    .map((item) => {
      const count =
        item === 'All Categories' ? products.length : products.filter((product) => product.category === item).length;
      return `
        <button class="filter-link ${state.category === item ? 'active' : ''}" data-action="category" data-category="${item}">
          ${item}
          <span>${count}</span>
        </button>
      `;
    })
    .join('');
}

function renderProducts() {
  byId('product-grid').innerHTML = filteredProducts()
    .map(
      (product) => `
        <article class="product-card">
          <button class="favorite-button" aria-label="Save ${escapeHtml(product.name)}">H</button>
          <img src="${product.image}" alt="${escapeHtml(product.name)}" />
          <div class="product-body">
            <span class="product-brand">${escapeHtml(product.brand)}</span>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.pack)}</p>
            <div class="tag-row">
              ${product.tags
                .slice(0, 2)
                .map((tag) => `<span>${escapeHtml(tag)}</span>`)
                .join('')}
            </div>
            <div class="price-row">
              <strong>${money.format(product.casePrice)} CS</strong>
              <span>${money.format(product.eachPrice)} EA</span>
            </div>
            <small>Last ordered ${escapeHtml(product.lastOrdered)}</small>
          </div>
          <div class="quantity-row">
            <button class="quantity-button" data-action="qty" data-product="${product.id}" data-delta="-1" aria-label="Remove one ${escapeHtml(product.name)}">-</button>
            <span>${state.cart[product.id] || 0}</span>
            <button class="add-button" data-action="qty" data-product="${product.id}" data-delta="1" aria-label="Add ${escapeHtml(product.name)}">
              Add to Cart
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </article>
      `,
    )
    .join('');
}

function renderCart() {
  const lines = cartLines();
  const total = lines.reduce((sum, item) => sum + item.casePrice * item.quantity, 0);
  byId('cart-count').textContent = `${lines.length} ${lines.length === 1 ? 'item' : 'items'}`;
  byId('cart-total').textContent = money.format(total);
  byId('cart-lines').innerHTML =
    lines.length === 0
      ? '<p class="empty-cart">Your basket is empty.</p>'
      : lines
          .map(
            (item) => `
              <div class="cart-line">
                <div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${item.quantity} CS - ${money.format(item.casePrice * item.quantity)}</span>
                </div>
                <button data-action="qty" data-product="${item.id}" data-delta="1" aria-label="Add one ${escapeHtml(item.name)}">+</button>
              </div>
            `,
          )
          .join('');
}

function render() {
  renderNav();
  renderFilters();
  renderProducts();
  renderCart();
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  if (button.dataset.action === 'nav') {
    state.activeNav = button.dataset.label;
    renderNav();
  }

  if (button.dataset.action === 'category') {
    state.category = button.dataset.category;
    render();
  }

  if (button.dataset.action === 'qty') {
    updateQuantity(Number(button.dataset.product), Number(button.dataset.delta));
  }
});

byId('catalog-search').addEventListener('input', (event) => {
  state.query = event.target.value;
  renderProducts();
});

render();
