const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-message');
const chatList = document.getElementById('chat-list');

const apiUrl = 'https://api.openai.com/v1/chat/completions';
const apiKey = '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'; // replace with your OpenAI API key

const previousMessages = [{
  role: 'system',
  content: `
Hi! I'm a chatbot that is good at making simple websites for it's users.

I can take any input info from you and then create a website for you.

I'll start by listing website outline and what info is included in every section.
I'm not going to ask any questions. I'll improvise based on my training data.

I'll output content of every file in the website.

I'll represent every file in output like this:

---index.html---
<html>
<head>
  <title>Hello, world!</title>
</head>
<body>
  <h1>Hello, world!</h1>
</body>
</html>
---index.html end---
  `
}];

// handle form submission
chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const userInput = chatInput.value.trim();
  if (userInput !== '') {
    addMessageToList(userInput, 'user');
    chatInput.value = '';
    getAiResponse()
      .then(data => {
        const aiResponse = data.choices[0].message.content.trim();
        addMessageToList(aiResponse, 'assistant');
      })
      .catch(error => console.error('Error:', error));
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
updateChatList();

function processAiResponse(text) {
  // Extract files from AI response
  const files = text.matchAll(/---([\w.]+)---(.+?)---([\w.]+) end---/gs);
  // ---file_name.ext--- - start of file
  // (.+) - file content
  // ---file_name.ext end--- - end of file

  for (let file of files) {
    const [, fileName, fileContent] = file;
    console.log('file name: ', fileName, 'file content: ', fileContent);
    updateFile(fileName, fileContent);
  }
}

// add message to chat list
function addMessageToList(text, sender) {
  previousMessages.push({
    role: sender,
    content: text
  });

  updateChatList();

  if (sender === 'assistant') {
    processAiResponse(text);
    updateChatList();
    updateFileList();
    previewWebsite();
  }
}

function cleanupText(text) {
  return text.replaceAll(/---([\w.]+)---(.+?)---([\w.]+) end---/gs, (_, fileName) => '`' + fileName + '`');
}

function updateChatList() {
  chatList.innerHTML = previousMessages.map(message => `
    <li class="${message.role === 'assistant' || message.role === 'system' ? 'ai-message' : 'user-message'}">
      <div class="message-text">${marked.marked(cleanupText(message.content))}</div>
    </li>
  `).join('\n');
  chatList.scrollTop = chatList.scrollHeight;
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

    getAiResponse(`Please give short summary of the following file: ${fileName}\n\n${fileContent}`)
      .then(data => {
        const aiResponse = data.choices[0].message.content.trim();
        document.querySelector('.file-summary').innerHTML = marked.marked(aiResponse);
      })
      .catch(error => console.error('Error:', error));
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

function getAiResponse(userInput) {
  const messages = [...previousMessages];

  if (userInput) {
    messages.push({
      role: 'user',
      content: userInput
    });
  }

  const requestBody = {
    model: 'gpt-3.5-turbo',
    messages
  };

  return fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  })
  .then(response => response.json())
}
