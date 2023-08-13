FROM hashicorp/vault

COPY ./file /vault/file
RUN chmod -R 777 /vault

CMD ["server"]
