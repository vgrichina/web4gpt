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

const files = [
  {
    name: 'index.html',
    content: `
      <html>
        <head>
          <title>Hello, world!</title>
        </head>
        <body>
          <h1>Hello, world!</h1>
        </body>
      </html>
    `
  }
];
updateFileList();

// add message to chat list
function addMessageToList(text, sender) {
  const messageLi = document.createElement('li');
  messageLi.classList.add(sender === 'ai' ? 'ai-message' : 'user-message');
  const parsedText = marked.marked(text.replaceAll(/---([\w.]+)---(.+?)---([\w.]+) end---/gs, (_, fileName) => '`' + fileName + '`'));
  messageLi.innerHTML = `
    <div class="message-text">${parsedText}</div>
  `;
  chatList.appendChild(messageLi);
  chatList.scrollTop = chatList.scrollHeight;

  if (sender === 'ai') {
    // Extract files from AI response
    const files = text.matchAll(/---([\w.]+)---(.+?)---([\w.]+) end---/gs);
    // ---file_name.ext--- - start of file
    // (.+) - file content
    // ---file_name.ext end--- - end of file

    for (let file of files) {
      console.log('file: ', file, Array.from(file));
      const [, fileName, fileContent] = file;
      console.log('file name: ', fileName, 'file content: ', fileContent);
      updateFile(fileName, fileContent);
    }

    updateFileList();
    previewWebsite();
  }
}

function updateFile(name, content) {
  const file = files.find(file => file.name === name);
  if (file) {
    file.content = content;
  } else {
    files.push({
      name,
      content
    });
  }
}

function clickFile(event) {
  const fileName = event.target.textContent;
  const file = files.find(file => file.name === fileName);
  if (file) {
    const fileContent = file.content;
    // Set .file-content
    const fileContentElement = document.querySelector('.file-content');
    fileContentElement.textContent = fileContent;
  }
}

function updateFileList() {
  const fileList = document.querySelector('.file-list');
  fileList.innerHTML = files.map(file => `
    <li onclick="clickFile(event)">${file.name}</li>
  `).join('\n'); // TODO: encode file name
}

function detectMimeType(fileName) {
  const extension = fileName.split('.').pop();
  if (extension === 'html') {
    return 'text/html';
  } else if (extension === 'css') {
    return 'text/css';
  } else if (extension === 'js') {
    return 'text/javascript';
  } else {
    return 'text/plain';
  }
}

function replaceUrls(content, links) {
  for (let link of links) {
    content = content.replaceAll(link.name, link.url);
  }

  return content;
}

function previewWebsite() {
  for (let file of files) {
    const url = URL.createObjectURL(new Blob([file.content], { type: detectMimeType(file.name) }));
    file.url = url;
  }

  const index = files.find(file => file.name === 'index.html');
  document.querySelector('.website-preview').srcdoc = replaceUrls(index.content, files);
}

// send user message to chat list
function sendMessage(text, sender) {
  addMessageToList(text, sender);
}

// get AI response and add to chat list
function getAiResponse(userInput) {
  const previousMessages = chatList.querySelectorAll('.user-message, .ai-message');
  const messages = [{
      role: 'system',
      content: `
        Hi! I'm a chatbot that is good at making simple websites for it's users.

        I can take any input info from you, ask you questions about missing info and then create a website for you.

        I'll start by listing website outline and which information is needed for each section. Then I'll ask you questions about the missing info.

        After that I'll generate website with separate .html, .css and .js files for you.
        I'll represent every file in output like this:

        ---file_name.ext---
        [actual file content goes here]
        ---file_name.ext end---
      `
  }].concat(Array.from(previousMessages).map(message => ({
    role: message.classList.contains('user-message') ? 'user' : 'assistant',
    content: message.querySelector('.message-text').textContent
  })));

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
