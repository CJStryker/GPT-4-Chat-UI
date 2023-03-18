import { Configuration, OpenAIApi } from "openai";

const api_key = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(api_key);

export default async function(req, res) {
  if (!req.body || !req.body.messages) {
    const errorResponse = {
      error: 'Bad Request: messages field is required'
    };
    res.status(400).json(errorResponse); 
    return;
}
  const Chat = await openai.createChatCompletion({
    model: "gpt-3.5-turbo-0301",
    messages: [{ "role": "system","content": "You are a helpful assistant."}].concat(req.body.messages)

  });
  res.status(200).json({ result: Chat.data.choices[0].message });
  res
}