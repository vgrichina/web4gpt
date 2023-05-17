const apiUrl = 'https://api.openai.com/v1/chat/completions';
const apiKey = process.env.OPENAPI_KEY;

export async function* getAiResponseStream({ messages, signal } = {}) {
    const response = await requestCompletions({
        messages,
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
                messages: [...messages.slice(1), { role: 'user', content: 'Please summarize previous messages. Make sure to include latest user input and website outline. It should be enough info to rebuild website.' }],
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

export async function requestCompletions({ messages, stream = false, signal }) {
    const requestBody = {
        model: 'gpt-3.5-turbo',
        messages: messages.filter((message) => message.role !== 'ui'),
        stream,
    };
    console.log('requestCompletions', requestBody);

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