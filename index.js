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
  console.log('Claude response:', JSON.stringify(data));

  if (!data.content || !data.content[0]) {
    throw new Error('No content: ' + JSON.stringify(data));
  }

  const raw = data.content[0].text;
  console.log('Raw:', raw);
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

app.post('/webhook', async (req, res) => {
  const userMessage = req.body.Body;
  const userPhone = req.body.From;
  console.log('Message:', userPhone, userMessage);

  if (!userLogs[userPhone]) userLogs[userPhone] = {};
  const today = getTodayKey();
  if (!userLogs[userPhone][today]) userLogs[userPhone][today] = { meals: [], total: 0 };

  try {
    const result = await analyzeFood(userMessage);
    userLogs[userPhone][today].meals.push(result);
    userLogs[userPhone][today].total += result.total;

    const dayTotal = userLogs[userPhone][today].total;
    const mealsCount = userLogs[userPhone][today].meals.length;
    const left = DAILY_GOAL - dayTotal;

    const itemsList = result.items.map(i => `- ${i.name}: ${i.calories} קל'`).join('\n');
    const status = left > 0
      ? `נותרו ${left} קל' מיעד ${DAILY_GOAL}`
      : `עברת את היעד ב-${Math.abs(left)} קל'`;

    const reply = `ארוחה ${mealsCount}:\n${itemsList}${result.note ? '\n' + result.note : ''}\n\nסהכ ארוחה: ${result.total} קל'\nסהכ היום: ${dayTotal} קל'\n${status}`;

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
```
