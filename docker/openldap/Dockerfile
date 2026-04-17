# Extend osixia/openldap with repo LDIF. Do not bind-mount `.../bootstrap/ldif/custom`:
# the image startup removes that path; a mount stays busy and fails with "Device or resource busy".

FROM osixia/openldap:1.5.0

COPY bootstrap/ /container/service/slapd/assets/config/bootstrap/ldif/custom/
