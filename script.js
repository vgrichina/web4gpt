import React, { useState, useEffect, useRef } from 'react';
import ReactSrcDocIframe from 'react-srcdoc-iframe';
import * as ReactDOMClient from 'react-dom/client';
import { marked } from 'marked';
import insane from 'insane';

import { uploadFiles } from './utils/nearfs-upload';
import { deploy } from './utils/deploy-contract';
import useThrottle from './hooks/use-throttle';
import { getAiResponseStream, requestCompletions } from './utils/chat-api';

const initialMessages = [
  {
    role: 'system',
    content: `
You are a chatbot that is good at making simple websites for it's users.

You can take any input info from user and then create a website.
You are not going to ask any questions. You'll improvise based on your training data.

You'll use placeholder.it images.

At first you'll generate outline for user's review in Markdown format.

After that you'll generate a list of files in such format:

\`\`\`
---sitemap---
- index.html
- about.html
- style.css
- script.js
---sitemap end---
\`\`\`

When asked for a specific file, you'll output it's content.

Prepend file content by:
---filename---

and append by:
---filename end---

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

  const sitemap = files.find(({ name }) => name === 'sitemap');
  const allFiles = sitemap && parseFilesToGenerate(sitemap.content);
  const readyToDeploy = allFiles && allFiles.every(fileName => files.some(({ name }) => name === fileName));

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
    const chunks = [];
    try {
      setChatIsLoading(true);
      for await (let aiResponse of getAiResponseStreamAfterInput(null, { signal: abortController.current.signal })) {
        appendToLastMessage(aiResponse);
        chunks.push(aiResponse);
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

    const aiResponse = chunks.join('');
    console.log('aiResponse: ', aiResponse);
    if (aiResponse.includes('---sitemap---')) {
      const sitemap = filesFromAiResponse(aiResponse).find(({ name }) => name === 'sitemap');
      if (sitemap) {
        // NOTE: Not updated otherwise
        updateFile(sitemap.name, sitemap.content);
        // TODO: Extract chat model separately

        const filesToGenerate = parseFilesToGenerate(sitemap.content);
        try {
          setChatIsLoading(true);
          // TODO: show file by file progress in UI?
          // Generate files
          await Promise.all(filesToGenerate.map(async (fileName) => {
            addMessageToList(`Generating file: ${fileName}`, 'assistant');
            await generateFile(fileName).catch((error) => {
              // TODO: show error in UI
              console.error('Error generating file:', fileName, error);
            });
            addMessageToList(`File ${fileName} generated`, 'assistant');
          }));

        } finally {
          setChatIsLoading(false);
        }
      }
    }
  };

  async function generateFile(fileName) {
    console.log('generating file: ', fileName);
    const aiResponse = await getAiResponse(`generate ${fileName}`);
    processAiResponse(aiResponse);
  }

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

  function filesFromAiResponse(aiResponse) {
    const files = aiResponse.matchAll(/---([\w.-]+)---(.+?)---([\w.-]+) end---/gs);
    // ---file_name.ext--- - start of file
    // (.+) - file content
    // ---file_name.ext end--- - end of file
    return Array.from(files, ([, fileName, fileContent]) => ({ name: fileName, content: fileContent }));
  }

  function processAiResponse(text) {
    // Extract files from AI response
    const files = filesFromAiResponse(text);
    for (let { name, content } of files) {
      console.log('file name: ', name, 'file content: ', content);
      updateFile(name, content);
    }
  }

  function cleanupText(text) {
    return text.replaceAll(/---([\w.-]+)---(.+?)---([\w.-]+) end---/gs, (_, fileName) => '`' + fileName + '`');
  }

  const addMessageToList = (text, sender) => {
    setMessages((prevMessages) => [...prevMessages, { role: sender, content: text }]);
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


  function getMessages() {
    return new Promise((resolve) => {
      setMessages((prevMessages) => {
        // NOTE: Is there cleaner way to get latest state?
        resolve(prevMessages);
        return prevMessages;
      });
    });
  }

  async function* getAiResponseStreamAfterInput(userInput, { role = 'user', signal } = {}) {
    let messages = await getMessages();

    if (userInput) {
      messages = [...messages, { role, content: userInput }];
    }

    yield* getAiResponseStream({ messages, signal });
  }

  async function getAiResponse(userInput) {
    const messages = await getMessages();

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
    try {
      setChatIsLoading(true);
      console.log('setChatIsLoading(true)');
      addMessageToList('Uploading files to NEARFS...', 'assistant');
      const rootCid = await uploadFiles(files);
      addMessageToList(`Files uploaded to NEARFS. Root CID: ${rootCid}. Deploying to web4.${accountId}`, 'assistant');
      await deploy({ accountId, staticUrl: `ipfs://${rootCid}` });
      addMessageToList(`Website deployed to [web4.${accountId}](https://${accountId}.page).`, 'assistant');
    } catch (error) {
      console.log('deployWebsite error', error);
      addMessageToList(`Error deploying website: ${error}`, 'assistant');
    } finally {
      console.log('setChatIsLoading(false)');
      setChatIsLoading(false);
    }
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
              { !chatIsLoading && !isLoggedIn && readyToDeploy &&
                <li>
                  <div className="message-text">
                    Please <a href="/web4/login?web4_contract_id=web4gpt.near">login</a> to deploy your website.
                  </div>
                </li>
              }
              { !chatIsLoading && isLoggedIn && readyToDeploy &&
                <li>
                  <button className="action-button" type="submit" onClick={deployWebsite}>Deploy</button>
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

function parseFilesToGenerate(aiResponse) {
  return Array.from(aiResponse.matchAll(/- ([\w.-]+)\n/gs)).map(match => match[1]);
}

