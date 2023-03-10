const audioUtils        = require('./audioUtils');  // for encoding audio data as PCM
const marshaller        = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
const util_utf8_node    = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8
const mic               = require('microphone-stream'); // collect microphone input as a stream of raw bytes

// our converter between binary event streams messages and JSON
const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);

// our global variables for managing state

let inputSampleRate;
let transcription = "";
let socket;
let micStream;
let socketError = false;
let transcribeException = false;
let sampleRate;
let url;

// check to see if the browser allows mic access
if (!window.navigator.mediaDevices.getUserMedia) {
    // Use our helper method to show an error on the page
    showError('We support the latest versions of Chrome, Firefox, Safari, and Edge. Update your browser and try your request again.');

    // maintain enabled/distabled state for the start and stop buttons
    toggleStartStop();
}

$('#start-button').click(function () {
    $('#error').hide(); // hide any existing errors
    toggleStartStop(true); // disable start and enable stop button

    sampleRate = 8000;

    fillTheImage();

    // first we get the microphone input from the browser (as a promise)...
    window.navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true
        })
        // ...then we convert the mic stream to binary event stream messages when the promise resolves 
        .then(streamAudioToWebSocket) 
        .catch(function (error) {
            showError('There was an error streaming your audio to Amazon Transcribe. Please try again.');
            // toggleStartStop();
        });
});

let streamAudioToWebSocket = async function (userMediaStream) {
    //let's get the mic input from the browser, via the microphone-stream module
    micStream = new mic();

    micStream.on("format", function(data) {
        inputSampleRate = data.sampleRate;
    });

    micStream.setStream(userMediaStream);

    // Pre-signed URLs are a way to authenticate a request (or WebSocket connection, in this case)
    // via Query Parameters. Learn more: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    url = await createPresignedUrl()

    socket = new WebSocket(url)

    //open up our WebSocket connection
    socket.binaryType = "arraybuffer";

   

    // when we get audio data from the mic, send it to the WebSocket if possible
    socket.onopen = function() {
        
        micStream.on('data', function(rawAudioChunk) {

            // the audio stream is raw audio bytes. Transcribe expects PCM with additional metadata, encoded as binary
            let binary = convertAudioToBinaryMessage(rawAudioChunk);

            if (socket.readyState === socket.OPEN)
                socket.send(binary);
        }
        
    )};

    // handle messages, errors, and close events
    wireSocketEvents();
}



// function setLanguage() {
//     languageCode = $('#language').find(':selected').val();
//     if (languageCode == "en-US" || languageCode == "es-US")
//         sampleRate = 44100;
//     else
//         sampleRate = 8000;
// }

// function setRegion() {
//     region = $('#region').find(':selected').val();
// }

function wireSocketEvents() {

    if (socket != null){

        // handle inbound messages from Amazon Transcribe
        socket.onmessage = function (message) {
            //convert the binary event stream message to JSON
            let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data));
            let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
            if (messageWrapper.headers[":message-type"].value === "event") {
                handleEventStreamMessage(messageBody);
            }
            else {
                transcribeException = true;
                showError(messageBody.Message);
                // toggleStartStop();
            }
        };

        socket.onerror = function () {
            socketError = true;
            showError('WebSocket connection error. Try again.');
            // toggleStartStop();
        };
        
        socket.onclose = function (closeEvent) {
            micStream.stop();
            
            // the close event immediately follows the error event; only handle one.
            if (!socketError && !transcribeException) {
                if (closeEvent.code != 1000) {
                    showError('</i><strong>Streaming Exception</strong><br>' + closeEvent.reason);
                }
                // toggleStartStop();
            }
        };

    }else{
        showError('WebSocket Null ');
    }
    
}

let handleEventStreamMessage = function (messageJson) {
    let results = messageJson.Transcript.Results;


    if (results.length > 0) {
        if (results[0].Alternatives.length > 0) {
            let transcript = results[0].Alternatives[0].Transcript;

            // fix encoding for accented characters
            transcript = decodeURIComponent(escape(transcript));

            

            // update the textarea with the latest result
            // $('#transcript').val(transcription + transcript + "\n");

            // if this transcript segment is final, add it to the overall transcription
            if (!results[0].IsPartial) {
                //scroll the textarea down
                // $('#transcript').scrollTop($('#transcript')[0].scrollHeight);
                for (word in transcript){
                    if (word == 'test'){
                        console.log('correct');
                    }else{
                        console.log('word = '+ word);
                    }
                }
                transcription += transcript + "\n";
            }
           
          
        }

    }
}



let closeSocket = function (socket) {
    if (socket != null && socket.readyState === socket.OPEN) {
        micStream.stop();

        // Send an empty frame so that Transcribe initiates a closure of the WebSocket after submitting all transcripts
        let emptyMessage = getAudioEventMessage(Buffer.from(new Buffer([])));
        let emptyBuffer = eventStreamMarshaller.marshall(emptyMessage);
        socket.send(emptyBuffer);
    }
}

$('#stop-button').click(function () {
    closeSocket();
    toggleStartStop();
});

// $('#reset-button').click(function (){
//     $('#transcript').val('');
//     transcription = '';
// });

function toggleStartStop(disableStart = false) {
    $('#start-button').prop('disabled', disableStart);
    $('#stop-button').attr("disabled", !disableStart);
}

function showError(message) {
    $('#error').html('<i class="fa fa-times-circle"></i> ' + message);
    $('#error').show();
}

function convertAudioToBinaryMessage(audioChunk) {
    let raw = mic.toRaw(audioChunk);

    if (raw == null)
        return;

    // downsample and convert the raw audio bytes to PCM
    let downsampledBuffer = audioUtils.downsampleBuffer(raw, inputSampleRate, sampleRate);
    let pcmEncodedBuffer = audioUtils.pcmEncode(downsampledBuffer);

    // add the right JSON headers and structure to the message
    let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer));

    //convert the JSON object + headers into a binary event stream message
    let binary = eventStreamMarshaller.marshall(audioEventMessage);

    return binary;
}

function getAudioEventMessage(buffer) {
    // wrap the audio data in a JSON envelope
    return {
        headers: {
            ':message-type': {
                type: 'string',
                value: 'event'
            },
            ':event-type': {
                type: 'string',
                value: 'AudioEvent'
            }
        },
        body: buffer
    };
}

async function createPresignedUrl() {
    var requestOptions = {
        method: 'GET',
        redirect: 'follow',
    };

    console.log("fetching url ")
  
    const post = await fetch(
        'https://468fvqwhtj.execute-api.eu-west-1.amazonaws.com/prod/createSignedURL',
        requestOptions
    )

    var url = await post.json();

    return url;
}

async function fillTheImage() {
    var requestOptions = {
      method: 'GET',
      redirect: 'follow',
    };

    var startImage = document.getElementById("start-image");
    startImage.style.display = "none";

    document.getElementById('imgId').style.display = "block";

    const post = await fetch(
      'https://468fvqwhtj.execute-api.eu-west-1.amazonaws.com/prod',
      requestOptions
    )
      .then((response) => response.text())
      //   .then((result) => console.log(result))
      .then(
        (result) =>
          (document.getElementById('imgId').data = result.replaceAll(
            '"',
            ''
          ))
      )
      .catch((error) => console.log('error', error));
}