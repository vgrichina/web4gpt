import React, { useState, useEffect, useRef } from 'react';
import ReactSrcDocIframe from 'react-srcdoc-iframe';
import * as ReactDOMClient from 'react-dom/client';
import { marked } from 'marked';
import insane from 'insane';

import { uploadFiles } from './utils/nearfs-upload';
import { deploy } from './utils/deploy-contract';
import useThrottle from './hooks/use-throttle';

const apiUrl = 'https://api.openai.com/v1/chat/completions';
const apiKey = process.env.OPENAPI_KEY;

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
  const [chatIsLoading, setChatIsLoading] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState(JSON.parse(localStorage.getItem('web4gpt:messages') || JSON.stringify(initialMessages)));
  const [files, setFiles] = useState(JSON.parse(localStorage.getItem('web4gpt:files') || JSON.stringify(initialFiles)));
  const [fileContent, setFileContent] = useState('');
  const [fileSummary, setFileSummary] = useState('');
  const [websitePreview, setWebsitePreview] = useState('');
  const chatBottomRef = useRef(null);

  let abortController = useRef(null);

  const accountIdCookie = document.cookie.split('; ').find((row) => row.startsWith('web4_account_id='));
  const accountId = accountIdCookie ? accountIdCookie.split('=')[1] : null;
  const isLoggedIn = !!accountId;

  useEffect(() => {
    previewWebsite('index.html');
  }, []);

  const throttledMessages = useThrottle(messages, 500);

  useEffect(() => {
    // Scroll to bottom of chat
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [throttledMessages]);

  // Update file list based on last message
  const lastAiResponse = (throttledMessages.findLast((message) => message.role === 'assistant') || { content: '' }).content;
  useEffect(() => {
    if (lastAiResponse.trim() === '') return;

    processAiResponse(lastAiResponse);
  }, [lastAiResponse]);

  useEffect(() => {
    localStorage.setItem('web4gpt:messages', JSON.stringify(throttledMessages));
  }, [throttledMessages]);

  useEffect(() => {
    localStorage.setItem('web4gpt:files', JSON.stringify(files));
  }, [files]);

  const onUserInputChange = (e) => {
    setUserInput(e.target.value);
  };

  const onFormSubmit = async (e) => {
    e.preventDefault();
    if (userInput.trim() === '') return;
    addMessageToList(userInput.trim(), 'user');
    setUserInput('');

    if (abortController.current) {
      console.warn('aborting previous request');
      abortController.current.abort();
    }
    abortController.current = new AbortController();

    addMessageToList('', 'assistant');
    try {
      setChatIsLoading(true);
      for await (let aiResponse of getAiResponseStream(userInput.trim(), { signal: abortController.current.signal })) {
        appendToLastMessage(aiResponse);
      }
    } catch (error) {
      console.error('Error in for await loop: ', error);

      if (error.name === 'AbortError') {
        console.warn('Request was aborted');
      } else {
        throw error;
      }
    } finally {
      setChatIsLoading(false);
    }
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

  const appendToLastMessage = (text) => {
    setMessages((prevMessages) => {
      // TODO: Find message to update by ID?
      const lastMessage = prevMessages[prevMessages.length - 1];
      if (lastMessage.role === 'assistant') {
        return [...prevMessages.slice(0, -1), { ...lastMessage, content: lastMessage.content + text }];
      }
      return prevMessages;
    });
  };

  const deleteMessage = (message) => {
    setMessages((prevMessages) => {
      const index = prevMessages.indexOf(message);
      return [...prevMessages.slice(0, index), ...prevMessages.slice(index + 1)]
    });
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
    if (!index) {
      setWebsitePreview(`
        <h1>File not found</h1>
        <p>Could not find file ${fileName}</p>`);
      return;
    }
    setWebsitePreview(replaceUrls(index.content));
  };

  async function requestCompletions({ messages, stream = false, signal }) {
    const requestBody = {
      model: 'gpt-3.5-turbo',
      messages,
      stream,
    };

    return await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal
    });
  }

  async function* getAiResponseStream(userInput, { signal } = {}) {
    const response = await requestCompletions({
      messages: [...messages, { role: 'user', content: userInput }],
      stream: true,
      signal
    });

    if (!response.ok) {
      const { error } = await response.json();
      console.log('error', error);

      if (error.code === 'context_length_exceeded') {
        // TODO: Tune this hack
        const summaryResponse = await requestCompletions({
          // NOTE: Skip system instructions for summary
          messages: [...messages.slice(1), { role: 'user', content: 'Please summarize previous messages. Make sure to include latest user input and website outline. It should be enough info to rebuilf website.' }],
          stream: true,
          signal
        });

        yield* parseAiResponseStream(summaryResponse);

        const nextResponse = await requestCompletions({
          messages: [messages[0], messages[messages.length - 1], { role: 'user', content: userInput }],
          stream: true,
          signal
        });

        yield* parseAiResponseStream(nextResponse);

        return;
      }

      throw new Error(`Error from AI: ${error.message}`);
    }

    yield* parseAiResponseStream(response);
  }

  async function* parseAiResponseStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) {
        return;
      }

      const text = decoder.decode(value);
      const chunks = text.split('\n\n');
      for (let chunk of chunks) {
        if (chunk.startsWith('data: ') && chunk != 'data: [DONE]') {
          const data = JSON.parse(chunk.slice(6));
          const content = data.choices[0].delta.content;
          if (content && content.length > 0) {
            yield content;
          }
        } else if (chunk.length > 0) {
          console.log('unprocessed chunk: ', chunk);
        }
      }
    }
  };

  async function getAiResponse(userInput) {
    const response = await requestCompletions({
      messages: [...messages, { role: 'user', content: userInput }]
    });

    const data = await response.json();
    if (data.choices) {
      return data.choices[0].message.content;
    }

    console.log('unexpected response: ', data);
    return '';
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

  function resetChat() {
    if (confirm('Are you sure you want to reset the chat? You gonna lose all your progress.')) {
      setMessages(initialMessages);
      setFiles([]);
      setFileContent('');
      setFileSummary('');
      setWebsitePreview('');
    }
  }

  async function deployWebsite() {
    const rootCid = await uploadFiles(files);
    await deploy({ accountId, staticUrl: `ipfs://${rootCid}` });
  }

  const ChatMessage = ({ message }) => {
    return (
      <li className={message.role === 'assistant' || message.role === 'system' ? 'ai-message' : 'user-message'}>
        <div className="message-text" dangerouslySetInnerHTML={{ __html: insane(marked(cleanupText(message.content))) }} />
        <a href='#' className="message-delete" onClick={() => deleteMessage(message)}>Delete</a>
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
          <div className="chat-header">
            {isLoggedIn
              ? <a className="deploy-button" href="#" onClick={deployWebsite}>Deploy</a>
              : <a className="login-button" href="/web4/login?web4_contract_id=web4gpt.near">Login</a>
            }
            Chat
            <a className="reset-button" href="#" onClick={resetChat}>Reset</a>
          </div>
          <div className="chat-history">
            <ul id="chat-list">
              {throttledMessages.map((message, index) => (
                <ChatMessage key={index} message={message} />
              ))}
              { chatIsLoading &&
                <li>
                  <div className="loader"></div>
                </li>
              }
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
          <div className="file-content">
            <pre><code>{fileContent}</code></pre>
          </div>
        </div>
        <div className="file-summary-container">
          <div className="file-summary" dangerouslySetInnerHTML={{ __html: insane(marked(fileSummary || '')) }} />
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
