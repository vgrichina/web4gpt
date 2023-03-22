import React, { useState, useEffect, useRef } from 'react';
import ReactSrcDocIframe from 'react-srcdoc-iframe';
import * as ReactDOMClient from 'react-dom/client';
import { marked } from 'marked';

const apiUrl = 'https://api.openai.com/v1/chat/completions';
const apiKey = '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'; // replace with your OpenAI API key

const initialMessages = [
  {
    role: 'system',
    content: `
Hi! I'm a chatbot that is good at making simple websites for it's users.

I can take any input info from you and then create a website for you.

I'll start by listing website outline and what info is included in every section.
I'm not going to ask any questions. I'll improvise based on my training data.

I'll use placeholder.it images.

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
  
I'm going to put all files top-level and avoid using Markdown in output.

`}];

const initialFiles = [
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

const objectUrlCache = {};

const ChatApp = () => {
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState(initialMessages);
  const [files, setFiles] = useState(initialFiles);
  const [fileContent, setFileContent] = useState('');
  const [fileSummary, setFileSummary] = useState('');
  const [websitePreview, setWebsitePreview] = useState('');
  const chatBottomRef = useRef(null);

  useEffect(() => {
    previewWebsite('index.html');
  }, []);

  useEffect(() => {
    // Scroll to bottom of chat
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const onUserInputChange = (e) => {
    setUserInput(e.target.value);
  };

  const onFormSubmit = async (e) => {
    e.preventDefault();
    if (userInput.trim() === '') return;
    addMessageToList(userInput.trim(), 'user');
    setUserInput('');
    const aiResponse = await getAiResponse(userInput.trim());
    addMessageToList(aiResponse, 'assistant');
  };

  const updateFile = (fileName, fileContent) => {
    console.log('updating file: ', fileName, 'with content: ', fileContent);
    setFiles((prevFiles) => {
      const updatedFiles = [...prevFiles];
      const index = updatedFiles.findIndex((file) => file.name === fileName);
      if (index === -1) {
        updatedFiles.push({ name: fileName, content: fileContent });
      } else {
        updatedFiles[index] = { ...updatedFiles[index], content: fileContent };
      }
      return updatedFiles;
    });
  };

  const processAiResponse = (text) => {
    // Extract files from AI response
    const files = text.matchAll(/---([\w.-]+)---(.+?)---([\w.-]+) end---/gs);
    // ---file_name.ext--- - start of file
    // (.+) - file content
    // ---file_name.ext end--- - end of file

    for (let file of files) {
      const [, fileName, fileContent] = file;
      console.log('file name: ', fileName, 'file content: ', fileContent);
      updateFile(fileName, fileContent);
    }
  }

  function cleanupText(text) {
    return text.replaceAll(/---([\w.-]+)---(.+?)---([\w.-]+) end---/gs, (_, fileName) => '`' + fileName + '`');
  }

  const addMessageToList = (text, sender) => {
    setMessages((prevMessages) => [...prevMessages, { role: sender, content: text }]);
    if (sender === 'assistant') {
      processAiResponse(text);
    }
  };

  const clickFile = async (fileName) => {
    const file = files.find((file) => file.name === fileName);
    if (file) {
      setFileContent(file.content);
      if (fileName.endsWith('.html')) {
        previewWebsite(fileName);
      }
      const aiResponse = await getAiResponse(`Please give a short summary of the following file: ${fileName}\n\n${file.content}`);
      setFileSummary(aiResponse);
    }
  };

  function replaceUrls(content) {
    for (let file of files) {
      content = content.replaceAll(file.name, objectURLForFile(file));
    }
    console.log('replaceUrls: ', content);
    return content;
  }

  function objectURLForFile(file) {
    const type = detectMimeType(file.name);
    const key = type + '\n' + file.content;
    if (objectUrlCache[key]) {
      return objectUrlCache[key];
    }
    const url = URL.createObjectURL(new Blob([file.content], { type }));
    objectUrlCache[key] = url;
    return url;
  }

  const previewWebsite = (fileName) => {
    const index = files.find((file) => file.name === fileName);
    setWebsitePreview(replaceUrls(index.content));
  };

  const getAiResponse = async (userInput) => {
    const requestBody = {
      model: 'gpt-3.5-turbo',
      messages: [...messages, { role: 'user', content: userInput }],
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`, // Replace with your OpenAI API key
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    const aiResponse = data.choices[0].message.content.trim();
    return aiResponse;
  };

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

  const ChatMessage = ({ message }) => {
    return (
      <li className={message.role === 'assistant' || message.role === 'system' ? 'ai-message' : 'user-message'}>
        <div className="message-text" dangerouslySetInnerHTML={{ __html: marked(cleanupText(message.content)) }} />
      </li>
    );
  };
  
  const FileListItem = ({ file, onClick }) => {
    return (
      <li onClick={() => onClick(file.name)} className="file-list-item">
        {file.name}
      </li>
    );
  };
  
  return (
    <div className="container">
      {/* Left column */}
      <div className="left-column">
        <div className="chat-container">
          <div className="chat-header">Chat</div>
          <div className="chat-history">
            <ul id="chat-list">
              {messages.map((message, index) => (
                <ChatMessage key={index} message={message} />
              ))}
            </ul>
            <div ref={chatBottomRef}></div>
          </div>
          <div className="chat-input">
            <form onSubmit={onFormSubmit}>
              <input
                type="text"
                id="chat-message"
                value={userInput}
                onChange={onUserInputChange}
                placeholder="Type your message here..."
              />
              <button type="submit">Send</button>
            </form>
          </div>
        </div>
      </div>
  
      {/* Right column */}
      <div className="right-column">
        <div className="file-list-container">
          <div className="file-list">
            <ul className="file-list">
              {files.map((file, index) => (
                <FileListItem key={index} file={file} onClick={clickFile} />
              ))}
            </ul>
          </div>
        </div>
  
        <div className="file-content-container">
          <div className="file-content">{fileContent}</div>
          <div className="file-summary" dangerouslySetInnerHTML={{ __html: marked(fileSummary) }} />
        </div>
  
        <div className="website-preview-container">
          <ReactSrcDocIframe
            className="website-preview"
            srcDoc={websitePreview}
            title="Website Preview"
            frameBorder="0"
          />
        </div>
      </div>
    </div>
  );
};

export default ChatApp;

const rootElement = document.getElementById('root');
const root = ReactDOMClient.createRoot(rootElement);
root.render(<ChatApp />);