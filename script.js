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
  const parsedText = marked.marked(text);
  messageLi.innerHTML = `
    <div class="message-text">${parsedText}</div>
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
  const previousMessages = chatList.querySelectorAll('.user-message, .ai-message');
  const messages = Array.from(previousMessages).map(message => ({
    role: message.classList.contains('user-message') ? 'user' : 'assistant',
    content: message.querySelector('.message-text').textContent
  }));

  messages.push({
    role: 'user',
    content: userInput
  });

  const requestBody = {
    model: 'gpt-3.5-turbo',
    messages
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
    const aiResponse = data.choices[0].message.content.trim();
    sendMessage(aiResponse, 'ai');
  })
  .catch(error => console.error('Error:', error));
}
