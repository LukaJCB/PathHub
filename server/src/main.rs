use tokio::io::{AsyncRead, AsyncReadExt};
use anyhow::{Result, bail};

// [magic][version]
// repeat:
//   [u16 nonce_len][nonce]
//   [u16 id_len][id]
//   [u64 blob_len][blob bytes]
pub const MAGIC: &[u8; 4] = b"EBL0";
pub const VERSION: u8 = 1;

pub struct RecordHeader {
    pub nonce: Vec<u8>,
    pub id: Vec<u8>,
    pub blob_len: u64,
}

async fn read_exact<const N: usize, R: AsyncRead + Unpin>(
    r: &mut R,
) -> Result<[u8; N]> {
    let mut buf = [0u8; N];
    r.read_exact(&mut buf).await?;
    Ok(buf)
}

fn u16_be(b: [u8; 2]) -> usize {
    u16::from_be_bytes(b) as usize
}

fn u64_be(b: [u8; 8]) -> u64 {
    u64::from_be_bytes(b)
}

pub async fn read_header<R: AsyncRead + Unpin>(r: &mut R) -> Result<()> {
    let magic = read_exact::<4, _>(r).await?;
    if &magic != MAGIC {
        bail!("bad magic");
    }

    let version = read_exact::<1, _>(r).await?[0];
    if version != VERSION {
        bail!("unsupported version");
    }

    Ok(())
}

pub async fn read_record_header<R: AsyncRead + Unpin>(
    r: &mut R,
) -> Result<Option<RecordHeader>> {
    let len_bytes = match r.read_exact(&mut [0u8; 2]).await {
        Ok(_) => read_exact::<2, _>(r).await?,
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Ok(None);
        }
        Err(e) => return Err(e.into()),
    };

    let nonce_len = u16_be(len_bytes);
    if nonce_len > 64 {
        bail!("nonce too large");
    }

    let mut nonce = vec![0u8; nonce_len];
    r.read_exact(&mut nonce).await?;

    let id_len = u16_be(read_exact::<2, _>(r).await?);
    if id_len > 256 {
        bail!("id too large");
    }

    let mut id = vec![0u8; id_len];
    r.read_exact(&mut id).await?;

    let blob_len = u64_be(read_exact::<8, _>(r).await?);
    if blob_len > 100 * 1024 * 1024 * 1024 {
        bail!("blob too large");
    }

    Ok(Some(RecordHeader {
        nonce,
        id,
        blob_len,
    }))
}


fn main() {
    println!("Hello, world!");
}

