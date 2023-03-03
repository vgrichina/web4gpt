const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-message');
const chatList = document.getElementById('chat-list');

const apiUrl = 'https://api.openai.com/v1/chat/completions';
const apiKey = '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'; // replace with your OpenAI API key

// handle form submission
chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const userInput = chatInput.value.trim();
  if (userInput !== '') {
    sendMessage(userInput, 'user');
    chatInput.value = '';
    getAiResponse(userInput);
  }
});

// add message to chat list
function addMessageToList(text, sender) {
  const messageLi = document.createElement('li');
  messageLi.classList.add(sender === 'ai' ? 'ai-message' : 'user-message');
  messageLi.innerHTML = `
    <div class="message-text">${text}</div>
  `;
  chatList.appendChild(messageLi);
  chatList.scrollTop = chatList.scrollHeight;
}

// send user message to chat list
function sendMessage(text, sender) {
  addMessageToList(text, sender);
}

// get AI response and add to chat list
function getAiResponse(userInput) {
  const requestBody = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        text: userInput,
        sender: 'user'
      },
      {
        text: '',
        sender: 'ai'
      }
    ],
    temperature: 0.5,
    n: 1,
    max_tokens: 100
  };

  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  })
  .then(response => response.json())
  .then(data => {
    const aiResponse = data.choices[0].text.trim();
    sendMessage(aiResponse, 'ai');
  })
  .catch(error => console.error('Error:', error));
}

