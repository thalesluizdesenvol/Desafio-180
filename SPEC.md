# Jogo da Vida - Evolução Completa

## Project Overview
- **Project Name**: Jogo da Vida - Evolua em 6 Meses
- **Type**: Interactive Web Application (Single HTML with two views)
- **Core Functionality**: Daily challenges game for couples to evolve in health, body, money, relationship, and career
- **Target Users**: Couple (AI Developer + Makeup Artist)

## UI/UX Specification

### Layout Structure
- **Header**: App title with animated gradient
- **User Selection**: Two buttons to choose view (Você / Sua Noiva)
- **Main Content**: 
  - Current day display (Day X of 180)
  - Challenge card with category badge
  - Progress stats
  - Streak counter
- **Navigation**: Previous/Next day controls

### Visual Design
- **Color Palette**:
  - Background: #0a0a0f (dark)
  - Primary: #ff6b35 (orange - energy)
  - Secondary: #00d4aa (teal - growth)
  - Accent: #f7b731 (gold - achievement)
  - Text: #ffffff / #a0a0a0
  - Cards: #15151f with gradient borders
- **Typography**: 
  - Headings: 'Orbitron', sans-serif (futuristic)
  - Body: 'Rajdhani', sans-serif
- **Effects**: 
  - Glowing borders on cards
  - Floating particles background
  - Smooth transitions between days

### Components
1. **User Selector**: Big buttons with avatars/icons
2. **Day Counter**: Progress bar with day number
3. **Challenge Card**: 
   - Category badge (Saúde/Corpo/Dinheiro/Relacionamento/Carreira)
   - Challenge title and description
   - XP points indicator
4. **Stats Panel**: Progress bars for each category
5. **Streak Counter**: Fire emoji + number
6. **Calendar View**: Month selector to see past/future challenges

## Functionality Specification

### Core Features
1. **Two User Views**: Separate pages for você (dev) and noiva (makeup artist)
2. **6-Month Calendar**: 180 days of unique challenges
3. **Categories**:
   - 💪 Saúde (Health)
   - 🔥 Corpo (Body/Fitness)
   - 💰 Dinheiro (Money)
   - 💕 Relacionamento (Relationship)
   - 🚀 Carreira (Career)
4. **Daily Challenges**: 
   - Each day has 1 main challenge + 1 mini challenge
   - Challenges are personalized per user
5. **Progress Tracking**: Visual progress bars per category
6. **Streak System**: Consecutive days completed

### Challenge Content -Você (AI Developer)
**Saúde:**
- Meditar 15 min
- Dormir antes das 23h
- Beber 3L água
- Comer café da manhã
- Não olhar celular 1h antes de dormir

**Corpo:**
- 30 min exercício
- Alongamento matinal
- Caminhada 5km
- 50 abdominais
- Postura correta o dia todo

**Dinheiro:**
- Ler 30 min sobre finanças
- Revisar gastos do mês
- Pesquisar renda extra
- Economizar R$50
- Criar uma nova fonte de renda

**Relacionamento:**
- Preparar café da manhã
- Elogiar algo específico
- Sem celular durante o jantar
- Mensagem carinhosa inesperada
- Planejar date

**Carreira:**
- Estudar 1h de IA
- Contribuir open source
- Atualizar portfólio
- Ler paper técnico
- Mentorar alguém

### Challenge Content - Ela (Makeup Artist)
**Saúde:**
- Meditar 10 min
- Dormir antes das 22h
- Beber 2L água
- Comer proteína no café
- Rotina de skincare

**Corpo:**
- 20 min exercício
- Alongamento
- Caminhada 3km
- Exercício facial
- Postura ao aplicar maquiagem

**Dinheiro:**
- Estudar precificação
- Organização financeira
- Pesquisar tendências mercado
- Economy challenge
- Criar pacote de serviços

**Relacionamento:**
- Preparar café da manhã
- Photo do dia a dia
- Planejar surpresa
- Sem celular 1h juntos
- Gratidão list

**Carreira:**
- Estudar técnica nova
- Criar conteúdo para insta
- Atualizar portfólio
- Assistir tutorial
- Praticar em si mesma

### User Interactions
- Click user button to switch views
- Arrow buttons to navigate days
- Click on month to jump
- Check challenge as done (updates streak/progress)
- LocalStorage to save progress

## Acceptance Criteria
1. ✅ Two distinct views load correctly
2. ✅ 180 unique challenges per user
3. ✅ Progress persists via localStorage
4. ✅ Smooth animations between days
5. ✅ Mobile responsive design
6. ✅ Category color coding visible
7. ✅ Streak counter works
8. ✅ Month navigation functional