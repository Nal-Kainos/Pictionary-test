function draw() {
    document.getElementById('vbanim').beginElement();
    console.log("Drawing")
}

async function fillTheImage() {
    var requestOptions = {
      method: 'GET',
      redirect: 'follow',
    };

    const post = await fetch(
      'https://468fvqwhtj.execute-api.eu-west-1.amazonaws.com/prod',
      requestOptions
    )
      .then((response) => response.text())
      //   .then((result) => console.log(result))
      .then(
        (result) =>
          (document.getElementById('imgId').src = result.replaceAll(
            '"',
            ''
          ))
      )
      .catch((error) => console.log('error', error));
}
  