import React from 'react';

const ImageViewer = (data: ArrayBuffer) => {
  const blob = new Blob([data]);
        const blobUrl = URL.createObjectURL(blob);


  return (
    <img src={blobUrl} alt="Decrypted content" />
  );
};

export default ImageViewer;
