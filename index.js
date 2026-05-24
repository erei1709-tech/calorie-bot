const express = require('express');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DAILY_GOAL = 2000;
const userLogs = {};

function getTodayKey() {
  return new Date().toLocaleDateString('he-IL');
}

function recalcTotal(day) {
  day.total = day.meals.reduce((sum, m) => sum + m.total, 0);
}

async function analyzeFood(text) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'אתה מומחה תזונה. החזר JSON בלבד ללא backticks:\n{"items":[{"name":"שם המאכל","calories":100}],"total":100,"note":""}',
      messages: [{ role: 'user', content: text }]
    })
  });

  const data = await response.json();
  if (!data.content || !data.content[0]) {
    throw new Error('No content: ' + JSON.stringify(data));
  }
  const raw = data.content[0].text;
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

app.post('/webhook', async (req, res) => {
  const userMessage = req.body.Body.trim();
  const userPhone = req.body.From;
  console.log('Message:', userPhone, userMessage);

  if (!userLogs[userPhone]) userLogs[userPhone] = {};
  const today = getTodayKey();
  if (!userLogs[userPhone][today]) userLogs[userPhone][today] = { meals: [], total: 0 };

  const day = userLogs[userPhone][today];

  if (userMessage.startsWith('/מחק')) {
    const foodToDelete = userMessage.replace('/מחק', '').trim();

    if (!foodToDelete) {
      if (day.meals.length === 0) {
        res.set('Content-Type', 'text/xml');
        return res.send(`<Response><Message>אין ארוחות למחוק היום.</Message></Response>`);
      }
      const deleted = day.meals.pop();
      recalcTotal(day);
      res.set('Content-Type', 'text/xml');
      return res.send(`<Response><Message>מחקתי את הארוחה האחרונה (${deleted.total} קל').\nסהכ היום עכשיו: ${day.total} קל'</Message></Response>`);
    } else {
      const idx = day.meals.findIndex(m =>
        m.items.some(i => i.name.includes(foodToDelete))
      );
      if (idx === -1) {
        res.set('Content-Type', 'text/xml');
        return res.send(`<Response><Message>לא מצאתי "${foodToDelete}" ברשימת הארוחות של היום.</Message></Response>`);
      }
      const deleted = day.meals.splice(idx, 1)[0];
      recalcTotal(day);
      res.set('Content-Type', 'text/xml');
      return res.send(`<Response><Message>מחקתי "${foodToDelete}" (${deleted.total} קל').\nסהכ היום עכשיו: ${day.total} קל'</Message></Response>`);
    }
  }

  if (userMessage === '/סיכום') {
    if (day.meals.length === 0) {
      res.set('Content-Type', 'text/xml');
      return res.send(`<Response><Message>לא תיעדת ארוחות היום עדיין.</Message></Response>`);
    }
    const lines = day.meals.map((m, i) =>
      `ארוחה ${i + 1}: ${m.items.map(it => it.name).join(', ')} - ${m.total} קל'`
    ).join('\n');
    const left = DAILY_GOAL - day.total;
    const status = left > 0 ? `נותרו ${left} קל'` : `עברת ב-${Math.abs(left)} קל'`;
    res.set('Content-Type', 'text/xml');
    return res.send(`<Response><Message>סיכום היום:\n${lines}\n\nסהכ: ${day.total} קל'\n${status}</Message></Response>`);
  }

  try {
    const result = await analyzeFood(userMessage);
    day.meals.push(result);
    recalcTotal(day);

    const left = DAILY_GOAL - day.total;
    const itemsList = result.items.map(i => `- ${i.name}: ${i.calories} קל'`).join('\n');
    const status = left > 0
      ? `נותרו ${left} קל' מיעד ${DAILY_GOAL}`
      : `עברת את היעד ב-${Math.abs(left)} קל'`;

    const reply = `ארוחה ${day.meals.length}:\n${itemsList}${result.note ? '\n' + result.note : ''}\n\nסהכ ארוחה: ${result.total} קל'\nסהכ היום: ${day.total} קל'\n${status}`;

    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${reply}</Message></Response>`);
  } catch (err) {
    console.error('Error:', err.message);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>שגיאה בחישוב, נסה שוב</Message></Response>`);
  }
});

app.get('/', (req, res) => res.send('Calorie Bot running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
