apikey = "INSERT_YOUR_OPENAI_APIKEY_HERE";
clipdrop = "INSERT_YOUR_CLIPDROP_APIKEY_HERE";

const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    organization: "INSERT_YOUR_OPENAI_ORGANIZATION_HERE",
    apiKey: apikey,
});
const openai = new OpenAIApi(configuration);

const http = require('http');
const fs = require('fs');
const { JSDOM } = require('jsdom');

robotDescription = "";
fs.readFile("robotDescription.txt", 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading the file:', err);
    } else {
        robotDescription = data;
    }
  });

imgDescriptionPrompt = "";
fs.readFile("imgDescriptionPrompt.txt", 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading the file:', err);
    } else {
        imgDescriptionPrompt = data;
    }
  });

summaryPrompt = "";
fs.readFile("summaryPrompt.txt", 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading the file:', err);
    } else {
        summaryPrompt = data;
    }
  });

chatHistory = [];
fs.readFile("chatHistory.txt", 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading the file:', err);
    } else {
        try {
            chatHistory = JSON.parse(data);
        }
        catch(e)
        {

        }
    }
  });

// settings
const bShowImage = true;
const bUseClipDrop = true;
// ~settings

// internal state bools
bInitialBoot = true;
bShowLastQuestion = false;

function readHTMLFile(callback) {
  fs.readFile('index.html', 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading HTML file:', err);
      return callback(err);
    }
    callback(null, data);
  });
}

function createParagraphs(text) {
    const lines = text.split(/\r?\n/);
    const paragraphs = lines.map(line => `<p>${line}</p>`);
    return paragraphs.join('');
  }

function showPage(req, res, story, img){
    readHTMLFile((err, html) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        } 
        else {
            const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
            const window = dom.window;
            const document = window.document;

            if (story != undefined)
            {
                document.getElementById("story").parentNode.innerHTML = createParagraphs(story);
            }

            if (img != undefined)
            {
                if (bUseClipDrop)
                {
                    const buffer = Buffer.from(img);
                    const base64String = buffer.toString('base64');
                    document.getElementById("image").setAttribute("src", "data:image/png;base64," + base64String);
                }
                else
                {
                    document.getElementById("image").setAttribute("src", img);
                }
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(dom.serialize());
        }
    });
}

function onAdventureReceived(req, res, adventure, bNewContent)
{
    if (bNewContent)
    {
        chatHistory.push({role: "assistant", content: adventure});

        fs.writeFile("chatHistory.txt", JSON.stringify(chatHistory), 'utf8', (err) => {
            if (err) {
            console.error('Error writing to file:', err);
            }
        });
    }

    if (bShowImage)
    {
        // get image description
        tmpHistory = [];
        tmpHistory.push({role: "assistant", content: adventure});
        tmpHistory.push({role: "user", content: imgDescriptionPrompt});

        const completion = openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: tmpHistory,
        }).then(function(tmpResponse)
        {
            imgDescr = String(tmpResponse.data.choices[0].message.content);

            console.log(imgDescr);

            if (bUseClipDrop)
            {
                const form = new FormData()
                form.append('prompt', imgDescr)
                
                fetch('https://clipdrop-api.co/text-to-image/v1', {
                method: 'POST',
                headers: {
                    'x-api-key': clipdrop,
                },
                body: form,
                })
                .then(response => response.arrayBuffer())
                .then(buffer => {
                    showPage(req, res, adventure, buffer);
                })
            }
            else
            { 
                const img = openai.createImage({
                    prompt: imgDescr,
                    n: 1,
                    size: "256x256",
                    }).then(function(imgResponse)
                    {
                        showPage(req, res, adventure, imgResponse.data.data[0].url);
                    }
                );
            }
        });
    }
    else
    {
        showPage(req, res, adventure);
    }
}

function showAdventure(req, res)
{
    if (bInitialBoot && chatHistory.length != 0)
    {
        // provide a summary of previous sessions
        bInitialBoot = false;
        tmpHistory = [...chatHistory];
        tmpHistory.push({ role: "user", content: summaryPrompt });   
        
        const completion = openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: tmpHistory,
        }).then(function(response){
            bShowLastQuestion = true;
            adventure = "Here is a summary of what happened last time:\n\n" + 
            String(response.data.choices[0].message.content) + "\n\nPress Yes to start today's adventure";
            onAdventureReceived(req, res, adventure, false);
        });
    }
    else if (bShowLastQuestion)
    {
        // repeat last exercise after summary, because player quit without completing it
        onAdventureReceived(req, res, chatHistory[chatHistory.length-1].content, false);
        bShowLastQuestion = false;
    }
    else
    {
        bInitialBoot = false;
        bShowLastQuestion = false;

        if (chatHistory.length == 0)
        {
            chatHistory.push({ role: "user", content: robotDescription });
        }
        else
        {
            chatHistory.push({ role: "user", content: "yes" });
        }
    
        const completion = openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: chatHistory,
        }).then(function(response)
        {
            adventure = String(response.data.choices[0].message.content);
            onAdventureReceived(req, res, adventure, true);
        });
    }
}

const server = http.createServer((req, res) => {
  if (req.url === '/styles.css') {
    fs.readFile('styles.css', 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(data);
      }
    });
  } 
  else if (req.url === '/clear') {
    chatHistory = [];
    bInitialBoot = true;
    bShowLastQuestion = false;
    showAdventure(req, res);
  }
  else if (req.url === '/' || req.url === '/start') {
    bInitialBoot = true;
    bShowLastQuestion = false;
    showAdventure(req, res);
  }
  else if (req.url === '/continue') {
    showAdventure(req, res);
  }
  else if (req.url === '/quit') {
    console.log("TODO: finalize the story and clear the history?");
  }
  else if (req.url === '/logo.png' || req.url === '/test.png') {
    var myurl = req.url.substring(1, 999);
    fs.readFile(myurl, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(data);
      }
    });
  }
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
